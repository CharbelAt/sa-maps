# Keep the JavaScript bridge methods (called by name from the web app).
-keepclassmembers class com.samaps.app.web.SANativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
