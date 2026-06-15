package com.example.codetalkie.ui

import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.example.codetalkie.data.PairCode
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

/**
 * 全屏取景扫码:CameraX 预览 + ML Kit 条码识别。
 * 扫到任意二维码就尝试用 PairCode.extract 抽 6 位配对码,命中即回调一次(随后由调用方关闭本屏)。
 * 相机权限须由调用方在进入前确认已授予。
 */
@Composable
fun QrScannerScreen(
    onCode: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val scanner = remember { BarcodeScanning.getClient() }
    // 只回调一次,避免重复 claim
    val fired = remember { booleanArrayOf(false) }

    DisposableEffect(Unit) {
        onDispose {
            executor.shutdown()
            scanner.close()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                val previewView = PreviewView(ctx)
                val providerFuture = ProcessCameraProvider.getInstance(ctx)
                providerFuture.addListener({
                    val provider = providerFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }
                    val resolution = ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(
                                Size(1280, 720),
                                ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER,
                            ),
                        )
                        .build()
                    val analysis = ImageAnalysis.Builder()
                        .setResolutionSelector(resolution)
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    analysis.setAnalyzer(executor) { proxy ->
                        @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
                        val media = proxy.image
                        if (media == null || fired[0]) {
                            proxy.close()
                            return@setAnalyzer
                        }
                        val input = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
                        scanner.process(input)
                            .addOnSuccessListener { barcodes ->
                                for (b in barcodes) {
                                    val raw = b.rawValue ?: continue
                                    val code = PairCode.extract(raw) ?: continue
                                    if (!fired[0]) {
                                        fired[0] = true
                                        ContextCompat.getMainExecutor(ctx).execute { onCode(code) }
                                    }
                                    break
                                }
                            }
                            .addOnCompleteListener { proxy.close() }
                    }
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analysis,
                    )
                }, ContextCompat.getMainExecutor(previewView.context))
                previewView
            },
        )
    }
}
