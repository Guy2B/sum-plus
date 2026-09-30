import Capacitor

/// Registers Σ's local native plugins with the Capacitor bridge.
class SigmaBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SigmaHealthPlugin())
    }
}
