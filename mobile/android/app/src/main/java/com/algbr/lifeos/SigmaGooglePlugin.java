package com.algbr.lifeos;

import android.accounts.Account;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import java.util.ArrayList;
import java.util.List;

/**
 * Silent Google authorization for background syncs.
 *
 * Asks Android's Authorization API for an access token covering the given
 * scopes. When the person already granted them, the token comes back without
 * any screen; otherwise the call is rejected with "needs-user" and the app shows
 * a discreet "reconnect" link instead of popping a window during an automatic sync.
 */
@CapacitorPlugin(name = "SigmaGoogle")
public class SigmaGooglePlugin extends Plugin {

    @PluginMethod
    public void authorize(PluginCall call) {
        List<Scope> scopes = new ArrayList<>();
        JSArray raw = call.getArray("scopes", new JSArray());
        try {
            for (Object s : raw.toList()) scopes.add(new Scope(String.valueOf(s)));
        } catch (Exception e) {
            call.reject("bad-scopes");
            return;
        }
        if (scopes.isEmpty()) {
            call.reject("bad-scopes");
            return;
        }
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder().setRequestedScopes(scopes);
        String email = call.getString("email");
        if (email != null && !email.isEmpty()) builder.setAccount(new Account(email, "com.google"));

        Identity.getAuthorizationClient(getContext())
            .authorize(builder.build())
            .addOnSuccessListener(result -> {
                if (result.hasResolution() || result.getAccessToken() == null) {
                    call.reject("needs-user");
                    return;
                }
                JSObject out = new JSObject();
                out.put("accessToken", result.getAccessToken());
                JSArray granted = new JSArray();
                for (String g : result.getGrantedScopes()) granted.put(g);
                out.put("grantedScopes", granted);
                call.resolve(out);
            })
            .addOnFailureListener(e -> call.reject("needs-user", e));
    }
}
