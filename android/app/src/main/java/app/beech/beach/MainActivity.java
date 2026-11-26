package app.beech.beach;

import android.view.Gravity;
import android.widget.TextView;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
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
