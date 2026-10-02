import Foundation
import Capacitor
import HealthKit

/// NEXT — Apple Health bridge.
///
/// Reads daily *summaries* only (sleep, steps, active minutes, resting heart
/// rate) after the user authorises HealthKit and has given separate consent
/// inside Σ. Nothing is written to HealthKit.
@objc(SigmaHealthPlugin)
public class SigmaHealthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SigmaHealthPlugin"
    public let jsName = "SigmaHealth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readSummary", returnType: CAPPluginReturnPromise)
    ]

    private let store = HKHealthStore()

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable(), "platform": "ios"])
    }

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        for id in [HKQuantityTypeIdentifier.stepCount, .appleExerciseTime, .restingHeartRate] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) { types.insert(sleep) }
        return types
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else { return call.reject("HealthKit unavailable", "native-health-unavailable") }
        store.requestAuthorization(toShare: [], read: readTypes) { granted, error in
            if let error = error { return call.reject(error.localizedDescription, "health-permission-denied") }
            // HealthKit never reveals read-permission denials; `granted` means the sheet was answered.
            call.resolve(["granted": granted])
        }
    }

    private func statistic(_ id: HKQuantityTypeIdentifier, _ start: Date, _ end: Date, _ option: HKStatisticsOptions, _ unit: HKUnit, _ done: @escaping (Double?) -> Void) {
        guard let type = HKQuantityType.quantityType(forIdentifier: id) else { return done(nil) }
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: .strictStartDate)
        let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: option) { _, result, _ in
            let q = option == .cumulativeSum ? result?.sumQuantity() : result?.averageQuantity()
            done(q?.doubleValue(for: unit))
        }
        store.execute(query)
    }

    /// Sleep for the night ending on `day`: samples from 18:00 the previous day to 12:00.
    private func sleepHours(endingOn day: Date, _ done: @escaping (Double?) -> Void) {
        guard let type = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else { return done(nil) }
        let cal = Calendar.current
        let start = cal.date(byAdding: .hour, value: -6, to: day)!
        let end = cal.date(byAdding: .hour, value: 12, to: day)!
        let predicate = HKQuery.predicateForSamples(withStart: start, end: end)
        let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, _ in
            let asleep: Set<Int>
            if #available(iOS 16.0, *) {
                asleep = [HKCategoryValueSleepAnalysis.asleepCore.rawValue, HKCategoryValueSleepAnalysis.asleepDeep.rawValue,
                          HKCategoryValueSleepAnalysis.asleepREM.rawValue, HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue]
            } else {
                asleep = [HKCategoryValueSleepAnalysis.asleep.rawValue]
            }
            let seconds = (samples as? [HKCategorySample] ?? [])
                .filter { asleep.contains($0.value) }
                .reduce(0.0) { $0 + $1.endDate.timeIntervalSince($1.startDate) }
            done(seconds > 0 ? seconds / 3600 : nil)
        }
        store.execute(query)
    }

    @objc func readSummary(_ call: CAPPluginCall) {
        let days = max(1, min(30, call.getInt("days") ?? 14))
        let cal = Calendar.current
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"

        let group = DispatchGroup()
        let lock = NSLock()
        var rows: [String: [String: Any]] = [:]
        func set(_ key: String, _ field: String, _ value: Double?) {
            guard let value = value else { return }
            lock.lock(); rows[key, default: ["date": key]][field] = value; lock.unlock()
        }

        for offset in 0..<days {
            guard let day = cal.date(byAdding: .day, value: -offset, to: cal.startOfDay(for: Date())) else { continue }
            let end = cal.date(byAdding: .day, value: 1, to: day)!
            let key = formatter.string(from: day)
            group.enter(); statistic(.stepCount, day, end, .cumulativeSum, .count()) { set(key, "steps", $0); group.leave() }
            group.enter(); statistic(.appleExerciseTime, day, end, .cumulativeSum, .minute()) { set(key, "activeMinutes", $0); group.leave() }
            group.enter(); statistic(.restingHeartRate, day, end, .discreteAverage, HKUnit.count().unitDivided(by: .minute())) { set(key, "restingHR", $0); group.leave() }
            group.enter(); sleepHours(endingOn: day) { set(key, "sleep", $0); group.leave() }
        }
        group.notify(queue: .main) {
            let entries = rows.values.sorted { ($0["date"] as? String ?? "") > ($1["date"] as? String ?? "") }
            call.resolve(["entries": entries])
        }
    }
}
