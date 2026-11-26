package app.beech.beach;

import android.content.pm.Signature;
import androidx.core.content.pm.PackageInfoCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;

/**
 * Read-only signing fingerprints of the installed APK, for sign-in
 * diagnostics. Google's native sign-in rejects the app when the
 * certificate that signed the installed APK has no matching Android OAuth
 * client, and the JS layer cannot read logcat — so the app needs the
 * fingerprints itself to say which key it was signed with. No permissions:
 * reading your own signing certificates is always allowed.
 */
@CapacitorPlugin(name = "SigningInfo")
public class SigningInfoPlugin extends Plugin {

    @PluginMethod
    public void getSigningInfo(PluginCall call) {
        try {
            List<Signature> signatures = PackageInfoCompat.getSignatures(
                getContext().getPackageManager(), getContext().getPackageName());
            List<String> sha1 = new ArrayList<>();
            List<String> sha256 = new ArrayList<>();
            for (Signature signature : signatures) {
                byte[] certificate = signature.toByteArray();
                sha1.add(fingerprint(certificate, "SHA-1"));
                sha256.add(fingerprint(certificate, "SHA-256"));
            }
            JSObject data = new JSObject();
            data.put("sha1", new JSONArray(sha1));
            data.put("sha256", new JSONArray(sha256));
            call.resolve(data);
        } catch (Exception e) {
            call.reject("Could not read signing info: " + e.getMessage());
        }
    }

    private static String fingerprint(byte[] certificate, String algorithm) throws Exception {
        byte[] digest = MessageDigest.getInstance(algorithm).digest(certificate);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < digest.length; i++) {
            if (i > 0) out.append(':');
            out.append(String.format("%02X", digest[i]));
        }
        return out.toString();
    }
}
