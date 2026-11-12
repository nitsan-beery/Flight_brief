import Capacitor

// המסך הראשי של האפליקציה. requirements.md, סעיף 6.5.
// – בוחר מאיזו תיקייה האפליקציה עולה: גרסה שהורדה מהרשת, או זו שארוזה בבנייה (WebUpdatePlugin).
// – רושם את התוספים שבתוך האפליקציה עצמה (לא מ-npm).
class AppViewController: CAPBridgeViewController {
    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        if let location = WebUpdatePlugin.launchLocation() { descriptor.appLocation = location }
        return descriptor
    }

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(GoogleAuthPlugin())
        bridge?.registerPluginInstance(WebUpdatePlugin())
    }
}
