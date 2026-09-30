package com.algbr.sigma.health

import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.LocalDate
import java.time.ZoneId

/**
 * Σ Life OS — Android Health Connect bridge.
 *
 * Health Connect also aggregates Samsung Health / Galaxy Watch data, so a
 * single integration covers both. Reads daily summaries only, after the
 * user grants the system permissions and has consented inside Σ.
 */
@CapacitorPlugin(name = "SigmaHealth")
class SigmaHealthPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val permissions = setOf(
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
    )

    private fun available(): Boolean =
        HealthConnectClient.getSdkStatus(context) == HealthConnectClient.SDK_AVAILABLE

    private fun client(): HealthConnectClient = HealthConnectClient.getOrCreate(context)

    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val result = JSObject()
        result.put("available", available())
        result.put("platform", "android")
        if (!available()) result.put("reason", "health-connect-missing-or-outdated")
        call.resolve(result)
    }

    @PluginMethod
    fun requestAuthorization(call: PluginCall) {
        if (!available()) return call.reject("Health Connect unavailable", "native-health-unavailable")
        scope.launch {
            val granted = client().permissionController.getGrantedPermissions()
            if (granted.containsAll(permissions)) {
                call.resolve(JSObject().put("granted", true))
                return@launch
            }
            val intent: Intent = PermissionController.createRequestPermissionResultContract()
                .createIntent(context, permissions)
            activity.runOnUiThread { startActivityForResult(call, intent, "onPermissionResult") }
        }
    }

    @ActivityCallback
    private fun onPermissionResult(call: PluginCall, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        scope.launch {
            val granted = client().permissionController.getGrantedPermissions()
            // Partial grants are fine: unreadable metrics are simply absent from summaries.
            call.resolve(JSObject().put("granted", granted.any { it in permissions }))
        }
    }

    @PluginMethod
    fun readSummary(call: PluginCall) {
        if (!available()) return call.reject("Health Connect unavailable", "native-health-unavailable")
        val days = (call.getInt("days") ?: 14).coerceIn(1, 30)
        scope.launch {
            try {
                val zone = ZoneId.systemDefault()
                val granted = client().permissionController.getGrantedPermissions()
                val entries = JSArray()
                for (offset in 0 until days) {
                    val day = LocalDate.now(zone).minusDays(offset.toLong())
                    val start = day.atStartOfDay(zone).toInstant()
                    val end = day.plusDays(1).atStartOfDay(zone).toInstant()
                    val row = JSObject().put("date", day.toString())
                    var hasData = false

                    if (HealthPermission.getReadPermission(StepsRecord::class) in granted) {
                        val agg = client().aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end)))
                        agg[StepsRecord.COUNT_TOTAL]?.let { row.put("steps", it); hasData = true }
                    }
                    if (HealthPermission.getReadPermission(ExerciseSessionRecord::class) in granted) {
                        val agg = client().aggregate(AggregateRequest(setOf(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL), TimeRangeFilter.between(start, end)))
                        agg[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL]?.let { row.put("activeMinutes", it.toMinutes()); hasData = true }
                    }
                    if (HealthPermission.getReadPermission(RestingHeartRateRecord::class) in granted) {
                        val agg = client().aggregate(AggregateRequest(setOf(RestingHeartRateRecord.BPM_AVG), TimeRangeFilter.between(start, end)))
                        agg[RestingHeartRateRecord.BPM_AVG]?.let { row.put("restingHR", it); hasData = true }
                    }
                    if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) {
                        // Night ending on `day`: sessions ending between 18:00 the day before and 18:00.
                        val nightStart = day.minusDays(1).atTime(18, 0).atZone(zone).toInstant()
                        val nightEnd = day.atTime(18, 0).atZone(zone).toInstant()
                        val sessions = client().readRecords(ReadRecordsRequest(SleepSessionRecord::class, TimeRangeFilter.between(nightStart, nightEnd))).records
                        val total = sessions.fold(Duration.ZERO) { acc, s -> acc.plus(Duration.between(s.startTime, s.endTime)) }
                        if (!total.isZero) { row.put("sleep", total.toMinutes() / 60.0); hasData = true }
                    }
                    if (hasData) entries.put(row)
                }
                call.resolve(JSObject().put("entries", entries))
            } catch (e: SecurityException) {
                call.reject("Permission denied", "health-permission-denied")
            } catch (e: Exception) {
                call.reject(e.message ?: "Health Connect error", "native-health-error")
            }
        }
    }

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }
}
