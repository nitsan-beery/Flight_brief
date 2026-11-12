import Capacitor

// המסך הראשי של האפליקציה. רושם את התוספים שבתוך האפליקציה עצמה (לא מ-npm). requirements.md, סעיף 6.5.
class AppViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GoogleAuthPlugin())
    }
}
