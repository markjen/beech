package app.beech.beach;

import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Read-only signing fingerprints for sign-in diagnostics (see
        // SigningInfoPlugin). Registered before the bridge is created.
        registerPlugin(SigningInfoPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        // Use the origin-scoped message bridge and document-start injection for hosted content.
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
                || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            TextView message = new TextView(this);
            message.setGravity(Gravity.CENTER);
            message.setText(R.string.update_webview);
            setContentView(message);
            return;
        }
        super.load();
    }
}
