package com.scanmart.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

public class MainActivity extends BridgeActivity {
    private static final int PERMISSION_REQUEST_CODE = 101;
    private PermissionRequest pendingPermissionRequest;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestCameraPermissions();
    }

    private void requestCameraPermissions() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{
                Manifest.permission.CAMERA,
                Manifest.permission.VIBRATE,
                Manifest.permission.READ_EXTERNAL_STORAGE
            }, PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        setupWebChromeClient();
    }

    @Override
    public void onResume() {
        super.onResume();
        setupWebChromeClient();
    }

    private void setupWebChromeClient() {
        if (this.bridge != null && this.bridge.getWebView() != null) {
            this.bridge.getWebView().setWebChromeClient(new BridgeWebChromeClient(this.bridge) {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    if (request == null) return;
                    runOnUiThread(() -> {
                        String[] resources = request.getResources();
                        boolean isVideoRequest = false;
                        for (String res : resources) {
                            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                                isVideoRequest = true;
                                break;
                            }
                        }

                        if (isVideoRequest) {
                            if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                request.grant(resources);
                            } else {
                                pendingPermissionRequest = request;
                                ActivityCompat.requestPermissions(MainActivity.this, new String[]{
                                    Manifest.permission.CAMERA
                                }, PERMISSION_REQUEST_CODE);
                            }
                        } else {
                            request.grant(resources);
                        }
                    });
                }
            });
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                if (pendingPermissionRequest != null) {
                    runOnUiThread(() -> {
                        try {
                            pendingPermissionRequest.grant(pendingPermissionRequest.getResources());
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                        pendingPermissionRequest = null;
                    });
                }
            } else {
                if (pendingPermissionRequest != null) {
                    runOnUiThread(() -> {
                        try {
                            pendingPermissionRequest.deny();
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                        pendingPermissionRequest = null;
                    });
                }
            }
        }
    }
}

