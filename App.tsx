import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import {
  Canvas,
  Fill,
  FilterMode,
  ImageFormat,
  ImageShader,
  MipmapMode,
  Shader,
  SkImage,
  Skia,
  TileMode,
  useImage,
} from 'react-native-skia';
import {
  ASTRO_PRESETS,
  ASTRO_SKSL_SHADER,
  AstroParams,
  AstroPreset,
  BgCornerModel,
  CurvePoints,
  DEFAULT_BG_MODEL,
  DEFAULT_CURVES,
} from './src/astroShader';

type CropAspect = 'original' | '1:1' | '4:5' | '16:9';
type ExportFormat = 'png' | 'jpeg';
type EditorTab = 'tune' | 'curves' | 'presets' | 'crop';
type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

interface HistData {
  r: number[];
  g: number[];
  b: number[];
}

interface ImageAnalysis {
  autoParams: AstroParams;
  bgModel: BgCornerModel;
  rawPixels: Uint8Array | null;
}

const CUSTOM_PRESETS_FILE = new File(Paths.document, 'astro_custom_presets.json');

function sampleDownscaledRGBA(img: SkImage, size = 64): Uint8Array | null {
  try {
    // Try CPU raster surface first for 100% reliable readPixels on all Android GPUs, then GPU offscreen
    const surface = Skia.Surface.Make(size, size) || Skia.Surface.MakeOffscreen(size, size);
    if (!surface) return null;

    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    canvas.drawImageRect(
      img,
      Skia.XYWHRect(0, 0, img.width(), img.height()),
      Skia.XYWHRect(0, 0, size, size),
      paint
    );
    surface.flush();

    const snap = surface.makeImageSnapshot();
    const raw = snap.readPixels();
    if (!raw) return null;
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof Float32Array) {
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        out[i] = Math.min(255, Math.max(0, Math.round(raw[i] * 255)));
      }
      return out;
    }
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  } catch {
    return null;
  }
}

function asinhJS(x: number, amount: number): number {
  if (amount <= 0.001) return x;
  const b = amount * 12.0;
  return Math.log(b * x + Math.sqrt(b * b * x * x + 1.0)) / Math.log(b + Math.sqrt(b * b + 1.0));
}

function evalSpline5JS(
  x: number,
  pts: [number, number, number, number, number]
): number {
  const c = Math.min(1, Math.max(0, x));
  const t = c * 4.0;
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (t <= 1.0) {
    const s = smooth(t);
    return pts[0] + (pts[1] - pts[0]) * (t * 0.55 + s * 0.45);
  } else if (t <= 2.0) {
    const u = t - 1.0;
    const s = smooth(u);
    return pts[1] + (pts[2] - pts[1]) * (u * 0.55 + s * 0.45);
  } else if (t <= 3.0) {
    const u = t - 2.0;
    const s = smooth(u);
    return pts[2] + (pts[3] - pts[2]) * (u * 0.55 + s * 0.45);
  } else {
    const u = t - 3.0;
    const s = smooth(u);
    return pts[3] + (pts[4] - pts[3]) * (u * 0.55 + s * 0.45);
  }
}

function computeHistogramFromCache(
  rawPixels: Uint8Array | null,
  params: AstroParams,
  bgModel: BgCornerModel
): HistData {
  const bins = 28;
  const fallback: HistData = {
    r: new Array(bins).fill(0.15),
    g: new Array(bins).fill(0.15),
    b: new Array(bins).fill(0.15),
  };

  if (!rawPixels || rawPixels.length < 16) return fallback;

  const histR = new Array(bins).fill(0);
  const histG = new Array(bins).fill(0);
  const histB = new Array(bins).fill(0);

  const N = Math.round(Math.sqrt(rawPixels.length / 4));
  const minCornerR = Math.min(bgModel.tl[0], bgModel.tr[0], bgModel.bl[0], bgModel.br[0]);
  const minCornerG = Math.min(bgModel.tl[1], bgModel.tr[1], bgModel.bl[1], bgModel.br[1]);
  const minCornerB = Math.min(bgModel.tl[2], bgModel.tr[2], bgModel.bl[2], bgModel.br[2]);

  for (let i = 0; i < rawPixels.length; i += 4) {
    let r = rawPixels[i] / 255;
    let g = rawPixels[i + 1] / 255;
    let b = rawPixels[i + 2] / 255;

    if (params.bgExtract > 0.001 && N > 1) {
      const px = (i / 4) % N;
      const py = Math.floor(i / 4 / N);
      const u = px / (N - 1);
      const v = py / (N - 1);
      const skyR =
        (bgModel.tl[0] * (1 - u) + bgModel.tr[0] * u) * (1 - v) +
        (bgModel.bl[0] * (1 - u) + bgModel.br[0] * u) * v;
      const skyG =
        (bgModel.tl[1] * (1 - u) + bgModel.tr[1] * u) * (1 - v) +
        (bgModel.bl[1] * (1 - u) + bgModel.br[1] * u) * v;
      const skyB =
        (bgModel.tl[2] * (1 - u) + bgModel.tr[2] * u) * (1 - v) +
        (bgModel.bl[2] * (1 - u) + bgModel.br[2] * u) * v;
      r = Math.max(0, r - Math.max(0, skyR - minCornerR) * params.bgExtract * 1.15);
      g = Math.max(0, g - Math.max(0, skyG - minCornerG) * params.bgExtract * 1.15);
      b = Math.max(0, b - Math.max(0, skyB - minCornerB) * params.bgExtract * 1.15);
    }

    if (params.blackPoint > 0.001) {
      const floor = params.blackPoint * 0.75;
      const denom = Math.max(0.05, 1 - floor);
      r = Math.max(0, r - floor) / denom;
      g = Math.max(0, g - floor) / denom;
      b = Math.max(0, b - floor) / denom;
    }

    if (params.stretch > 0.001) {
      const curL = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (curL > 0.0001) {
        const targetL = asinhJS(curL, params.stretch);
        const ratio = targetL / curL;
        r *= ratio;
        g *= ratio;
        b *= ratio;
      }
    }

    const curves = params.curves || DEFAULT_CURVES;
    r = evalSpline5JS(evalSpline5JS(r, curves.r), curves.rgb);
    g = evalSpline5JS(evalSpline5JS(g, curves.g), curves.rgb);
    b = evalSpline5JS(evalSpline5JS(b, curves.b), curves.rgb);

    if (Math.abs(params.temperature) > 0.001 || Math.abs(params.tint) > 0.001) {
      r *= 1 + params.temperature * 0.35 + params.tint * 0.15;
      g *= 1 - params.tint * 0.25;
      b *= 1 - params.temperature * 0.35 + params.tint * 0.15;
    }

    if (params.scnrGreen > 0.001) {
      const avgRB = (r + b) * 0.5;
      g = g + (Math.min(g, avgRB) - g) * params.scnrGreen;
    }

    r = Math.min(1, Math.max(0, r));
    g = Math.min(1, Math.max(0, g));
    b = Math.min(1, Math.max(0, b));

    histR[Math.min(bins - 1, Math.floor(r * bins))]++;
    histG[Math.min(bins - 1, Math.floor(g * bins))]++;
    histB[Math.min(bins - 1, Math.floor(b * bins))]++;
  }

  const logR = histR.map((v) => Math.log1p(v));
  const logG = histG.map((v) => Math.log1p(v));
  const logB = histB.map((v) => Math.log1p(v));
  const maxLog = Math.max(0.001, ...logR, ...logG, ...logB);

  return {
    r: logR.map((v) => v / maxLog),
    g: logG.map((v) => v / maxLog),
    b: logB.map((v) => v / maxLog),
  };
}

function analyzeAstroImage(img: SkImage): ImageAnalysis {
  const defaultResult: ImageAnalysis = {
    autoParams: ASTRO_PRESETS[0].params,
    bgModel: DEFAULT_BG_MODEL,
    rawPixels: null,
  };

  try {
    const N = 64;
    const pixels = sampleDownscaledRGBA(img, N);
    if (!pixels) return defaultResult;

    const lumas: number[] = [];
    const qTL: { l: number; rgb: [number, number, number] }[] = [];
    const qTR: { l: number; rgb: [number, number, number] }[] = [];
    const qBL: { l: number; rgb: [number, number, number] }[] = [];
    const qBR: { l: number; rgb: [number, number, number] }[] = [];

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const idx = (y * N + x) * 4;
        const r = pixels[idx] / 255;
        const g = pixels[idx + 1] / 255;
        const b = pixels[idx + 2] / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumas.push(l);

        const entry = { l, rgb: [r, g, b] as [number, number, number] };
        if (y < N / 2 && x < N / 2) qTL.push(entry);
        else if (y < N / 2 && x >= N / 2) qTR.push(entry);
        else if (y >= N / 2 && x < N / 2) qBL.push(entry);
        else qBR.push(entry);
      }
    }

    const getQuadrantSky = (
      arr: { l: number; rgb: [number, number, number] }[]
    ): [number, number, number] => {
      if (arr.length === 0) return [0, 0, 0];
      arr.sort((a, b) => a.l - b.l);
      const start = Math.floor(arr.length * 0.08);
      const end = Math.max(start + 1, Math.floor(arr.length * 0.22));
      let sr = 0,
        sg = 0,
        sb = 0,
        count = 0;
      for (let i = start; i < end; i++) {
        sr += arr[i].rgb[0];
        sg += arr[i].rgb[1];
        sb += arr[i].rgb[2];
        count++;
      }
      return [sr / count, sg / count, sb / count];
    };

    const bgModel: BgCornerModel = {
      tl: getQuadrantSky(qTL),
      tr: getQuadrantSky(qTR),
      bl: getQuadrantSky(qBL),
      br: getQuadrantSky(qBR),
    };

    lumas.sort((a, b) => a - b);
    const p08 = lumas[Math.floor(lumas.length * 0.08)] ?? 0.05;
    const p50 = lumas[Math.floor(lumas.length * 0.5)] ?? 0.15;
    const p95 = lumas[Math.floor(lumas.length * 0.95)] ?? 0.75;

    const isBrightTarget = p50 > 0.34 || (p08 < 0.04 && p95 > 0.78);

    if (isBrightTarget) {
      return {
        rawPixels: pixels,
        bgModel: DEFAULT_BG_MODEL,
        autoParams: {
          stretch: 0.22,
          blackPoint: Math.min(0.08, Math.max(0.01, Number((p08 * 0.75).toFixed(2)))),
          bgExtract: 0.0,
          scnrGreen: 0.4,
          waveletFine: 1.15,
          waveletMed: 0.78,
          denoise: 0.45,
          vibrance: 0.35,
          temperature: 0.0,
          tint: 0.0,
          starControl: 0.0,
          curves: {
            rgb: [0.0, 0.21, 0.53, 0.81, 1.0],
            r: [0.0, 0.25, 0.5, 0.75, 1.0],
            g: [0.0, 0.25, 0.5, 0.75, 1.0],
            b: [0.0, 0.25, 0.5, 0.75, 1.0],
          },
        },
      };
    }

    // Stronger, punchy Auto Pro deep-sky calibration
    const autoStretch = Math.min(0.84, Math.max(0.45, Number((0.88 - p50 * 1.45).toFixed(2))));
    const autoBlack = Math.min(0.24, Math.max(0.03, Number((p08 * 0.92).toFixed(2))));

    return {
      rawPixels: pixels,
      bgModel,
      autoParams: {
        stretch: autoStretch,
        blackPoint: autoBlack,
        bgExtract: 0.88,
        scnrGreen: 0.68,
        waveletFine: 0.5,
        waveletMed: 0.48,
        denoise: 0.7,
        vibrance: 0.58,
        temperature: 0.02,
        tint: 0.0,
        starControl: 0.44,
        curves: {
          rgb: [0.0, 0.2, 0.55, 0.82, 1.0],
          r: [0.0, 0.25, 0.51, 0.76, 1.0],
          g: [0.0, 0.25, 0.5, 0.75, 1.0],
          b: [0.0, 0.25, 0.51, 0.76, 1.0],
        },
      },
    };
  } catch {
    return defaultResult;
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AstroEditorScreen />
    </SafeAreaProvider>
  );
}

function AstroEditorScreen() {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const [imageUri, setImageUri] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EditorTab>('tune');
  const [activeCurveChannel, setActiveCurveChannel] = useState<CurveChannel>('rgb');
  const [activePresetId, setActivePresetId] = useState<string>('auto_pro');
  const [customPresets, setCustomPresets] = useState<AstroPreset[]>([]);
  const [params, setParams] = useState<AstroParams>(ASTRO_PRESETS[0].params);
  const [bgModel, setBgModel] = useState<BgCornerModel>(DEFAULT_BG_MODEL);
  const [rawPixels, setRawPixels] = useState<Uint8Array | null>(null);

  const [isDraggingControl, setIsDraggingControl] = useState<boolean>(false);

  // Viewport inspection modes
  const [showOriginal, setShowOriginal] = useState<boolean>(false);
  const [splitEnabled, setSplitEnabled] = useState<boolean>(false);
  const [splitRatio, setSplitRatio] = useState<number>(0.5);
  const [showHistogram, setShowHistogram] = useState<boolean>(false);
  const [showClipping, setShowClipping] = useState<boolean>(false);

  // Framing: Crop & Rotate
  const [cropAspect, setCropAspect] = useState<CropAspect>('original');
  const [quarterTurns, setQuarterTurns] = useState<number>(0);
  const [fineAngle, setFineAngle] = useState<number>(0);

  // Export & Save Preset Modal
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [saveModalVisible, setSaveModalVisible] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [renderTick, setRenderTick] = useState<number>(0);

  // Pinch-to-zoom & pan state
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const gestureStartRef = useRef({
    zoom: 1,
    panX: 0,
    panY: 0,
    pinchDist: 0,
    touchX: 0,
    touchY: 0,
    isPinching: false,
  });

  const skImage = useImage(imageUri);

  useEffect(() => {
    try {
      if (CUSTOM_PRESETS_FILE.exists) {
        const text = CUSTOM_PRESETS_FILE.textSync();
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          // Ensure older saved presets have default curves
          const migrated = parsed.map((p: AstroPreset) => ({
            ...p,
            params: {
              ...ASTRO_PRESETS[0].params,
              ...p.params,
              curves: p.params?.curves ?? DEFAULT_CURVES,
            },
          }));
          setCustomPresets(migrated);
        }
      }
    } catch {
      // Ignore corrupt preset file
    }
  }, []);

  const persistCustomPresets = (updated: AstroPreset[]) => {
    setCustomPresets(updated);
    try {
      CUSTOM_PRESETS_FILE.write(JSON.stringify(updated));
    } catch {
      // Ignore write error
    }
  };

  const runtimeEffect = useMemo(() => {
    const effect = Skia.RuntimeEffect.Make(ASTRO_SKSL_SHADER);
    if (!effect) {
      console.error('Failed to compile Astro SkSL shader');
    }
    return effect;
  }, []);

  useEffect(() => {
    if (skImage) {
      const analysis = analyzeAstroImage(skImage);
      setRawPixels(analysis.rawPixels);
      setBgModel(analysis.bgModel);
      setActivePresetId('auto_pro');
      setParams(analysis.autoParams);
      setCropAspect('original');
      setQuarterTurns(0);
      setFineAngle(0);
      setShowOriginal(false);
      resetZoom();
      setRenderTick((t) => t + 1);
    }
  }, [skImage]);

  const originalPreset = ASTRO_PRESETS[ASTRO_PRESETS.length - 1];
  const activeParams = showOriginal ? originalPreset.params : params;

  const histData = useMemo(() => {
    return computeHistogramFromCache(rawPixels, activeParams, bgModel);
  }, [rawPixels, activeParams, bgModel]);

  const cropRect = useMemo(() => {
    if (!skImage) return { x: 0, y: 0, w: 100, h: 100 };
    const isRotated90 = quarterTurns % 2 === 1;
    const effW = isRotated90 ? skImage.height() : skImage.width();
    const effH = isRotated90 ? skImage.width() : skImage.height();

    if (cropAspect === 'original') {
      return { x: 0, y: 0, w: effW, h: effH };
    }

    const targetRatio =
      cropAspect === '1:1' ? 1 : cropAspect === '4:5' ? 4 / 5 : 16 / 9;
    const currentRatio = effW / effH;

    let cropW = effW;
    let cropH = effH;
    if (currentRatio > targetRatio) {
      cropW = Math.round(effH * targetRatio);
    } else {
      cropH = Math.round(effW / targetRatio);
    }

    return {
      x: Math.round((effW - cropW) / 2),
      y: Math.round((effH - cropH) / 2),
      w: cropW,
      h: cropH,
    };
  }, [skImage, cropAspect, quarterTurns]);

  const canvasDimensions = useMemo(() => {
    const maxWidth = screenWidth - 24;
    const maxHeight = Math.min(300, Math.round(screenHeight * 0.35));
    if (!skImage) {
      return { width: maxWidth, height: Math.min(250, maxHeight), nativeScaleRatio: 1 };
    }
    const fitScale = Math.min(maxWidth / cropRect.w, maxHeight / cropRect.h);
    return {
      width: Math.round(cropRect.w * fitScale),
      height: Math.round(cropRect.h * fitScale),
      nativeScaleRatio: Math.max(1, 1 / fitScale),
    };
  }, [skImage, cropRect, screenWidth, screenHeight]);

  const maxZoom = useMemo(() => {
    return Math.max(4, Number((canvasDimensions.nativeScaleRatio * 1.5).toFixed(2)));
  }, [canvasDimensions.nativeScaleRatio]);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const maxOffsetX = ((z - 1) * canvasDimensions.width) / 2;
      const maxOffsetY = ((z - 1) * canvasDimensions.height) / 2;
      return {
        x: Math.min(maxOffsetX, Math.max(-maxOffsetX, x)),
        y: Math.min(maxOffsetY, Math.max(-maxOffsetY, y)),
      };
    },
    [canvasDimensions.width, canvasDimensions.height]
  );

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomToNative100 = useCallback(() => {
    const target = Math.min(maxZoom, Math.max(1, canvasDimensions.nativeScaleRatio));
    zoomRef.current = target;
    panRef.current = { x: 0, y: 0 };
    setZoom(target);
    setPan({ x: 0, y: 0 });
  }, [canvasDimensions.nativeScaleRatio, maxZoom]);

  const getTouchDistance = (touches: readonly { pageX: number; pageY: number }[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.hypot(dx, dy);
  };

  const splitEnabledRef = useRef(splitEnabled);
  splitEnabledRef.current = splitEnabled;

  const viewportPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !splitEnabledRef.current,
        onMoveShouldSetPanResponder: (_, gs) =>
          !splitEnabledRef.current &&
          (Math.abs(gs.dx) > 2 || Math.abs(gs.dy) > 2 || gs.numberActiveTouches >= 2),
        onPanResponderGrant: (evt: GestureResponderEvent) => {
          const touches = evt.nativeEvent.touches;
          gestureStartRef.current = {
            zoom: zoomRef.current,
            panX: panRef.current.x,
            panY: panRef.current.y,
            pinchDist: touches.length >= 2 ? getTouchDistance(touches) : 0,
            touchX: touches[0]?.pageX ?? 0,
            touchY: touches[0]?.pageY ?? 0,
            isPinching: touches.length >= 2,
          };
        },
        onPanResponderMove: (evt: GestureResponderEvent) => {
          const touches = evt.nativeEvent.touches;
          if (touches.length >= 2) {
            const dist = getTouchDistance(touches);
            if (!gestureStartRef.current.isPinching || gestureStartRef.current.pinchDist === 0) {
              gestureStartRef.current.isPinching = true;
              gestureStartRef.current.pinchDist = dist;
              gestureStartRef.current.zoom = zoomRef.current;
              return;
            }
            const ratio = dist / gestureStartRef.current.pinchDist;
            const nextZoom = Math.min(maxZoom, Math.max(1, gestureStartRef.current.zoom * ratio));
            const nextPan = clampPan(panRef.current.x, panRef.current.y, nextZoom);
            zoomRef.current = nextZoom;
            panRef.current = nextPan;
            setZoom(nextZoom);
            setPan(nextPan);
          } else if (touches.length === 1 && !gestureStartRef.current.isPinching) {
            if (zoomRef.current <= 1.01) return;
            const dx = touches[0].pageX - gestureStartRef.current.touchX;
            const dy = touches[0].pageY - gestureStartRef.current.touchY;
            const nextPan = clampPan(
              gestureStartRef.current.panX + dx,
              gestureStartRef.current.panY + dy,
              zoomRef.current
            );
            panRef.current = nextPan;
            setPan(nextPan);
          }
        },
        onPanResponderRelease: () => {
          gestureStartRef.current.isPinching = false;
        },
      }),
    [clampPan, maxZoom]
  );

  const splitRatioRef = useRef(0.5);
  const splitStartRef = useRef(0.5);
  const canvasWidthRef = useRef(canvasDimensions.width);
  canvasWidthRef.current = canvasDimensions.width;

  const splitPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        splitStartRef.current = splitRatioRef.current;
        setIsDraggingControl(true);
      },
      onPanResponderMove: (_, gs) => {
        const w = Math.max(1, canvasWidthRef.current);
        const next = Math.min(0.95, Math.max(0.05, splitStartRef.current + gs.dx / w));
        splitRatioRef.current = next;
        setSplitRatio(next);
      },
      onPanResponderRelease: () => {
        setIsDraggingControl(false);
      },
      onPanResponderTerminate: () => {
        setIsDraggingControl(false);
      },
    })
  ).current;

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission Required', 'Please grant photo library access to load astrophotos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  };

  const applyPreset = useCallback(
    (preset: AstroPreset) => {
      if (preset.id === 'auto_pro' && skImage) {
        const analysis = analyzeAstroImage(skImage);
        setActivePresetId('auto_pro');
        setParams(analysis.autoParams);
        setBgModel(analysis.bgModel);
        setShowOriginal(false);
        setRenderTick((t) => t + 1);
        return;
      }
      setActivePresetId(preset.id);
      setParams({
        ...preset.params,
        curves: {
          rgb: [...preset.params.curves.rgb],
          r: [...preset.params.curves.r],
          g: [...preset.params.curves.g],
          b: [...preset.params.curves.b],
        },
      });
      setShowOriginal(false);
      setRenderTick((t) => t + 1);
    },
    [skImage]
  );

  const updateParamValue = useCallback((key: keyof Omit<AstroParams, 'curves'>, newVal: number) => {
    setActivePresetId('custom');
    setShowOriginal(false);
    setParams((prev) => ({
      ...prev,
      [key]: Number(newVal.toFixed(2)),
    }));
    setRenderTick((t) => t + 1);
  }, []);

  const updateCurvePoint = useCallback(
    (channel: CurveChannel, pointIndex: number, newVal: number) => {
      setActivePresetId('custom');
      setShowOriginal(false);
      setParams((prev) => {
        const nextArr = [...prev.curves[channel]] as [number, number, number, number, number];
        nextArr[pointIndex] = Number(Math.min(1, Math.max(0, newVal)).toFixed(2));
        return {
          ...prev,
          curves: {
            ...prev.curves,
            [channel]: nextArr,
          },
        };
      });
      setRenderTick((t) => t + 1);
    },
    []
  );

  const resetCurveChannel = useCallback((channel: CurveChannel) => {
    setActivePresetId('custom');
    setShowOriginal(false);
    setParams((prev) => ({
      ...prev,
      curves: {
        ...prev.curves,
        [channel]: [0.0, 0.25, 0.5, 0.75, 1.0],
      },
    }));
    setRenderTick((t) => t + 1);
  }, []);

  const handleSaveCustomPreset = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) {
      Alert.alert('Name Required', 'Enter a name for your custom preset.');
      return;
    }
    const created: AstroPreset = {
      id: `custom_${Date.now()}`,
      name: trimmed,
      description: 'Saved custom profile',
      isCustom: true,
      params: {
        ...params,
        curves: {
          rgb: [...params.curves.rgb],
          r: [...params.curves.r],
          g: [...params.curves.g],
          b: [...params.curves.b],
        },
      },
    };
    persistCustomPresets([created, ...customPresets]);
    setActivePresetId(created.id);
    setNewPresetName('');
    setSaveModalVisible(false);
  };

  const handleDeleteCustomPreset = (preset: AstroPreset) => {
    if (!preset.isCustom) return;
    Alert.alert('Delete Preset', `Remove "${preset.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          persistCustomPresets(customPresets.filter((p) => p.id !== preset.id));
          if (activePresetId === preset.id) {
            setActivePresetId('custom');
          }
        },
      },
    ]);
  };

  const renderProcessedFile = async (): Promise<{ uri: string; width: number; height: number }> => {
    if (!skImage || !runtimeEffect) {
      throw new Error('Image or shader not ready');
    }

    const outW = cropRect.w;
    const outH = cropRect.h;

    const surface = Skia.Surface.MakeOffscreen(outW, outH);
    if (!surface) {
      throw new Error('Could not allocate offscreen GPU surface');
    }

    const imgShader = skImage.makeShaderOptions(
      TileMode.Clamp,
      TileMode.Clamp,
      FilterMode.Linear,
      MipmapMode.None
    );

    const c = params.curves || DEFAULT_CURVES;
    const uniformValues = [
      skImage.width(),
      skImage.height(),
      params.stretch,
      params.blackPoint,
      params.bgExtract,
      params.scnrGreen,
      params.waveletFine,
      params.waveletMed,
      params.denoise,
      params.vibrance,
      params.temperature,
      params.tint,
      params.starControl,
      ...bgModel.tl,
      ...bgModel.tr,
      ...bgModel.bl,
      ...bgModel.br,
      0.0,
      ...c.rgb,
      ...c.r,
      ...c.g,
      ...c.b,
    ];

    const finalShader = runtimeEffect.makeShaderWithChildren(uniformValues, [imgShader]);
    const canvas = surface.getCanvas();
    const paint = Skia.Paint();
    paint.setShader(finalShader);

    canvas.save();
    canvas.translate(outW / 2, outH / 2);
    const totalDeg = quarterTurns * 90 + fineAngle;
    if (totalDeg !== 0) {
      canvas.rotate(totalDeg, 0, 0);
      if (fineAngle !== 0) {
        const rad = (Math.abs(fineAngle) * Math.PI) / 180;
        const zoomFill = Math.cos(rad) + Math.sin(rad) * Math.max(outW / outH, outH / outW);
        canvas.scale(zoomFill, zoomFill);
      }
    }
    canvas.translate(-skImage.width() / 2, -skImage.height() / 2);
    canvas.drawRect(Skia.XYWHRect(0, 0, skImage.width(), skImage.height()), paint);
    canvas.restore();
    surface.flush();

    const snapshot = surface.makeImageSnapshot();
    const encodedBytes =
      exportFormat === 'jpeg'
        ? await Promise.resolve(snapshot.encodeToBytes(ImageFormat.JPEG, 95))
        : await Promise.resolve(snapshot.encodeToBytes());

    const ext = exportFormat === 'jpeg' ? 'jpg' : 'png';
    const outFile = new File(Paths.cache, `astro_${Date.now()}.${ext}`);
    outFile.write(encodedBytes);

    return { uri: outFile.uri, width: outW, height: outH };
  };

  const handleSaveToGallery = async () => {
    try {
      setIsExporting(true);
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Allow photo library access to save your enhanced image.');
        return;
      }
      const { uri, width, height } = await renderProcessedFile();
      await MediaLibrary.saveToLibraryAsync(uri);
      Alert.alert(
        'Saved',
        `Full-resolution (${width}x${height} ${exportFormat.toUpperCase()}) saved to your gallery.`
      );
    } catch (err) {
      Alert.alert('Save Error', err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareImage = async () => {
    try {
      setIsExporting(true);
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Unavailable', 'Sharing is not supported on this device.');
        return;
      }
      const { uri } = await renderProcessedFile();
      await Sharing.shareAsync(uri, {
        mimeType: exportFormat === 'jpeg' ? 'image/jpeg' : 'image/png',
        dialogTitle: 'Share Enhanced Astrophoto',
      });
    } catch (err) {
      Alert.alert('Share Error', err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const buildUniformObj = (p: AstroParams, clipFlag: boolean) => {
    const c = p.curves || DEFAULT_CURVES;
    return {
      resolution: [canvasDimensions.width, canvasDimensions.height],
      stretch: p.stretch,
      blackPoint: p.blackPoint,
      bgExtract: p.bgExtract,
      scnrGreen: p.scnrGreen,
      waveletFine: p.waveletFine,
      waveletMed: p.waveletMed,
      denoise: p.denoise,
      vibrance: p.vibrance,
      temperature: p.temperature,
      tint: p.tint,
      starControl: p.starControl,
      bgTL: bgModel.tl,
      bgTR: bgModel.tr,
      bgBL: bgModel.bl,
      bgBR: bgModel.br,
      showClipping: clipFlag ? 1.0 : 0.0,
      curveRGB0: c.rgb[0],
      curveRGB1: c.rgb[1],
      curveRGB2: c.rgb[2],
      curveRGB3: c.rgb[3],
      curveRGB4: c.rgb[4],
      curveR0: c.r[0],
      curveR1: c.r[1],
      curveR2: c.r[2],
      curveR3: c.r[3],
      curveR4: c.r[4],
      curveG0: c.g[0],
      curveG1: c.g[1],
      curveG2: c.g[2],
      curveG3: c.g[3],
      curveG4: c.g[4],
      curveB0: c.b[0],
      curveB1: c.b[1],
      curveB2: c.b[2],
      curveB3: c.b[3],
      curveB4: c.b[4],
    };
  };

  const editedUniforms = buildUniformObj(activeParams, showClipping && !showOriginal);
  const rawUniforms = buildUniformObj(originalPreset.params, false);

  const zoomPercent = skImage
    ? Math.round((zoom / canvasDimensions.nativeScaleRatio) * 100)
    : 100;

  const allPresets = useMemo(() => [...customPresets, ...ASTRO_PRESETS], [customPresets]);

  const totalPreviewDeg = quarterTurns * 90 + fineAngle;
  const fineFillScale = useMemo(() => {
    if (fineAngle === 0) return 1;
    const rad = (Math.abs(fineAngle) * Math.PI) / 180;
    return Math.cos(rad) + Math.sin(rad) * 1.4;
  }, [fineAngle]);

  const baseImageScale = useMemo(() => {
    if (!skImage) return 1;
    const isRot90 = quarterTurns % 2 === 1;
    const effW = isRot90 ? skImage.height() : skImage.width();
    const effH = isRot90 ? skImage.width() : skImage.height();
    return Math.max(effW / cropRect.w, effH / cropRect.h) * fineFillScale;
  }, [skImage, quarterTurns, cropRect, fineFillScale]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor="#070A12" />

      {/* PINNED TOP: Header + Live Preview Viewport */}
      <View style={styles.pinnedTop}>
        <View style={styles.header}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.title}>AstroEnhancer</Text>
            <Text style={styles.subtitle}>DBE • SCNR • Wavelets • Color Curves</Text>
          </View>
          <Pressable style={styles.primaryBtn} onPress={pickImage}>
            <Text style={styles.primaryBtnText}>{imageUri ? 'Change Photo' : 'Open Photo'}</Text>
          </Pressable>
        </View>

        <View style={[styles.canvasContainer, { height: canvasDimensions.height + (skImage ? 40 : 0) }]}>
          {skImage && runtimeEffect ? (
            <>
              <View
                {...(!splitEnabled ? viewportPanResponder.panHandlers : {})}
                style={[
                  styles.viewportClip,
                  { width: canvasDimensions.width, height: canvasDimensions.height },
                ]}
              >
                {/* Processed Layer */}
                <View
                  style={{
                    width: canvasDimensions.width,
                    height: canvasDimensions.height,
                    transform: [
                      { translateX: pan.x },
                      { translateY: pan.y },
                      { scale: zoom * baseImageScale },
                      { rotate: `${totalPreviewDeg}deg` },
                    ],
                  }}
                >
                  <Canvas
                    key={`canvas-${renderTick}-${showOriginal ? 'orig' : 'edit'}-${showClipping ? 'clip' : 'noclip'}`}
                    style={{ width: canvasDimensions.width, height: canvasDimensions.height }}
                  >
                    <Fill>
                      <Shader source={runtimeEffect} uniforms={editedUniforms}>
                        <ImageShader
                          image={skImage}
                          fit="contain"
                          rect={{
                            x: 0,
                            y: 0,
                            width: canvasDimensions.width,
                            height: canvasDimensions.height,
                          }}
                        />
                      </Shader>
                    </Fill>
                  </Canvas>
                </View>

                {/* Split-Screen Raw Overlay (Left Side) */}
                {splitEnabled && (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: canvasDimensions.width * splitRatio,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: canvasDimensions.width,
                        height: canvasDimensions.height,
                        transform: [
                          { translateX: pan.x },
                          { translateY: pan.y },
                          { scale: zoom * baseImageScale },
                          { rotate: `${totalPreviewDeg}deg` },
                        ],
                      }}
                    >
                      <Canvas style={{ width: canvasDimensions.width, height: canvasDimensions.height }}>
                        <Fill>
                          <Shader source={runtimeEffect} uniforms={rawUniforms}>
                            <ImageShader
                              image={skImage}
                              fit="contain"
                              rect={{
                                x: 0,
                                y: 0,
                                width: canvasDimensions.width,
                                height: canvasDimensions.height,
                              }}
                            />
                          </Shader>
                        </Fill>
                      </Canvas>
                    </View>
                  </View>
                )}

                {/* Draggable Split Wipe Handle */}
                {splitEnabled && (
                  <View
                    {...splitPanResponder.panHandlers}
                    style={[
                      styles.splitLineWrap,
                      { left: canvasDimensions.width * splitRatio - 26 },
                    ]}
                  >
                    <View style={styles.splitLine} />
                    <View style={styles.splitHandle}>
                      <Text style={styles.splitHandleText}>◀ ▶</Text>
                    </View>
                  </View>
                )}

                {/* Always-Reliable Live RGB Histogram HUD */}
                {showHistogram && (
                  <View pointerEvents="none" style={styles.histBox}>
                    <View style={styles.histBars}>
                      {histData.r.map((_, i) => (
                        <View key={i} style={styles.histCol}>
                          <View
                            style={[
                              styles.histBar,
                              {
                                height: Math.max(2, histData.b[i] * 46),
                                backgroundColor: 'rgba(56, 189, 248, 0.72)',
                              },
                            ]}
                          />
                          <View
                            style={[
                              styles.histBar,
                              {
                                height: Math.max(2, histData.g[i] * 46),
                                backgroundColor: 'rgba(74, 222, 128, 0.62)',
                              },
                            ]}
                          />
                          <View
                            style={[
                              styles.histBar,
                              {
                                height: Math.max(2, histData.r[i] * 46),
                                backgroundColor: 'rgba(248, 113, 113, 0.62)',
                              },
                            ]}
                          />
                        </View>
                      ))}
                    </View>
                    <Text style={styles.histLabel}>RGB HISTOGRAM</Text>
                  </View>
                )}
              </View>

              {/* Viewport HUD Bar */}
              <View style={styles.viewportBar}>
                <View style={styles.zoomGroup}>
                  <Pressable
                    style={[styles.barChip, showOriginal && styles.barChipWarn]}
                    onPress={() => {
                      setSplitEnabled(false);
                      setShowOriginal((v) => !v);
                      setRenderTick((t) => t + 1);
                    }}
                  >
                    <Text style={styles.barChipText}>{showOriginal ? 'Raw' : 'Compare'}</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.barChip, { marginLeft: 5 }, splitEnabled && styles.barChipActive]}
                    onPress={() => {
                      setShowOriginal(false);
                      setSplitEnabled((v) => !v);
                    }}
                  >
                    <Text style={styles.barChipText}>Split</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.barChip, { marginLeft: 5 }, showHistogram && styles.barChipActive]}
                    onPress={() => setShowHistogram((v) => !v)}
                  >
                    <Text style={styles.barChipText}>Hist</Text>
                  </Pressable>

                  <Pressable
                    style={[styles.barChip, { marginLeft: 5 }, showClipping && styles.barChipWarn]}
                    onPress={() => {
                      setShowClipping((v) => !v);
                      setRenderTick((t) => t + 1);
                    }}
                  >
                    <Text style={styles.barChipText}>Clip</Text>
                  </Pressable>
                </View>

                <View style={styles.zoomGroup}>
                  <Pressable style={styles.barChip} onPress={zoomToNative100}>
                    <Text style={styles.barChipText}>{zoomPercent}%</Text>
                  </Pressable>
                  {zoom > 1.02 && (
                    <Pressable style={[styles.barChip, { marginLeft: 5 }]} onPress={resetZoom}>
                      <Text style={styles.barChipText}>Fit</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            </>
          ) : (
            <Pressable style={styles.emptyState} onPress={pickImage}>
              <Text style={styles.emptyTitle}>Tap to Load Astrophoto</Text>
              <Text style={styles.emptyDesc}>
                Dynamic Background Extraction • Color Curves • SCNR • Wavelets • Crop & Rotate
              </Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* MIDDLE SCROLLABLE AREA WITH 4 TABS */}
      {skImage ? (
        <>
          <View style={styles.tabBar}>
            <Pressable
              style={[styles.tabBtn, activeTab === 'tune' && styles.tabBtnActive]}
              onPress={() => setActiveTab('tune')}
            >
              <Text style={[styles.tabText, activeTab === 'tune' && styles.tabTextActive]}>
                Pipeline
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'curves' && styles.tabBtnActive]}
              onPress={() => setActiveTab('curves')}
            >
              <Text style={[styles.tabText, activeTab === 'curves' && styles.tabTextActive]}>
                Curves
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'presets' && styles.tabBtnActive]}
              onPress={() => setActiveTab('presets')}
            >
              <Text style={[styles.tabText, activeTab === 'presets' && styles.tabTextActive]}>
                Profiles ({allPresets.length})
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tabBtn, activeTab === 'crop' && styles.tabBtnActive]}
              onPress={() => setActiveTab('crop')}
            >
              <Text style={[styles.tabText, activeTab === 'crop' && styles.tabTextActive]}>
                Crop
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.middleScroll}
            contentContainerStyle={styles.middleScrollContent}
            scrollEnabled={!isDraggingControl}
          >
            {activeTab === 'curves' && (
              <CurveEditorCard
                curves={params.curves || DEFAULT_CURVES}
                activeChannel={activeCurveChannel}
                onSelectChannel={setActiveCurveChannel}
                onChangePoint={(idx, val) => updateCurvePoint(activeCurveChannel, idx, val)}
                onResetChannel={() => resetCurveChannel(activeCurveChannel)}
                onDragStateChange={setIsDraggingControl}
              />
            )}

            {activeTab === 'presets' && (
              <>
                <View style={styles.presetHeaderRow}>
                  <Text style={styles.sectionTitle}>Target & Saved Profiles</Text>
                  <Pressable style={styles.savePresetChip} onPress={() => setSaveModalVisible(true)}>
                    <Text style={styles.savePresetChipText}>+ Save Current</Text>
                  </Pressable>
                </View>
                <View style={styles.presetGrid}>
                  {allPresets.map((preset) => {
                    const isSelected = activePresetId === preset.id && !showOriginal;
                    return (
                      <Pressable
                        key={preset.id}
                        style={[styles.presetGridCard, isSelected && styles.presetCardActive]}
                        onPress={() => applyPreset(preset)}
                        onLongPress={() => handleDeleteCustomPreset(preset)}
                      >
                        <Text style={[styles.presetName, isSelected && styles.presetNameActive]}>
                          {preset.isCustom ? `★ ${preset.name}` : preset.name}
                        </Text>
                        <Text style={styles.presetDesc}>{preset.description}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}

            {activeTab === 'tune' && (
              <View style={styles.controlsCard}>
                <SliderRow
                  label="Detail Stretch (Asinh)"
                  value={params.stretch}
                  min={0}
                  max={1}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('stretch', v)}
                />
                <SliderRow
                  label="Sky Background Floor"
                  value={params.blackPoint}
                  min={0}
                  max={0.35}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('blackPoint', v)}
                />
                <SliderRow
                  label="Gradient Removal (DBE)"
                  value={params.bgExtract}
                  min={0}
                  max={1}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('bgExtract', v)}
                />
                <SliderRow
                  label="Green Cast Removal (SCNR)"
                  value={params.scnrGreen}
                  min={0}
                  max={1}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('scnrGreen', v)}
                />
                <SliderRow
                  label="Star Halo Tightening"
                  value={params.starControl}
                  min={0}
                  max={1}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('starControl', v)}
                />
                <SliderRow
                  label="Wavelet Sharpen (Fine)"
                  value={params.waveletFine}
                  min={0}
                  max={1.5}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('waveletFine', v)}
                />
                <SliderRow
                  label="Wavelet Structure (Medium)"
                  value={params.waveletMed}
                  min={0}
                  max={1.5}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('waveletMed', v)}
                />
                <SliderRow
                  label="Natural Midtone Vibrance"
                  value={params.vibrance}
                  min={0}
                  max={1.5}
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('vibrance', v)}
                />
                <SliderRow
                  label="White Balance (Cool ↔ Warm)"
                  value={params.temperature}
                  min={-0.5}
                  max={0.5}
                  signed
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('temperature', v)}
                />
                <SliderRow
                  label="Tint (Green ↔ Magenta)"
                  value={params.tint}
                  min={-0.5}
                  max={0.5}
                  signed
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('tint', v)}
                />
                <SliderRow
                  label="Hot-Pixel & Chroma Denoise"
                  value={params.denoise}
                  min={0}
                  max={1}
                  isLast
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => updateParamValue('denoise', v)}
                />
              </View>
            )}

            {activeTab === 'crop' && (
              <View style={styles.controlsCard}>
                <Text style={styles.cropSectionLabel}>Aspect Ratio</Text>
                <View style={styles.aspectRow}>
                  {(['original', '1:1', '4:5', '16:9'] as CropAspect[]).map((asp) => (
                    <Pressable
                      key={asp}
                      style={[styles.aspectChip, cropAspect === asp && styles.aspectChipActive]}
                      onPress={() => {
                        setCropAspect(asp);
                        resetZoom();
                      }}
                    >
                      <Text
                        style={[
                          styles.aspectChipText,
                          cropAspect === asp && styles.aspectChipTextActive,
                        ]}
                      >
                        {asp === 'original' ? 'Original' : asp}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <Text style={[styles.cropSectionLabel, { marginTop: 12 }]}>Orientation</Text>
                <View style={styles.aspectRow}>
                  <Pressable
                    style={styles.aspectChip}
                    onPress={() => {
                      setQuarterTurns((q) => (q + 3) % 4);
                      resetZoom();
                    }}
                  >
                    <Text style={styles.aspectChipText}>↺ Rotate -90°</Text>
                  </Pressable>
                  <Pressable
                    style={styles.aspectChip}
                    onPress={() => {
                      setQuarterTurns((q) => (q + 1) % 4);
                      resetZoom();
                    }}
                  >
                    <Text style={styles.aspectChipText}>↻ Rotate +90°</Text>
                  </Pressable>
                  <Pressable
                    style={styles.aspectChip}
                    onPress={() => {
                      setCropAspect('original');
                      setQuarterTurns(0);
                      setFineAngle(0);
                      resetZoom();
                    }}
                  >
                    <Text style={styles.aspectChipText}>Reset All</Text>
                  </Pressable>
                </View>

                <SliderRow
                  label="Fine Tilt / Leveling Angle"
                  value={fineAngle}
                  min={-15}
                  max={15}
                  unit="°"
                  isLast
                  onDragStateChange={setIsDraggingControl}
                  onChange={(v) => setFineAngle(Number(v.toFixed(1)))}
                />
              </View>
            )}
          </ScrollView>

          {/* PINNED BOTTOM: Format Toggle + Save + Share */}
          <View style={[styles.pinnedBottom, { paddingBottom: Math.max(12, insets.bottom + 8) }]}>
            <View style={styles.bottomRow}>
              <Pressable
                style={styles.formatBtn}
                onPress={() => setExportFormat((f) => (f === 'png' ? 'jpeg' : 'png'))}
              >
                <Text style={styles.formatBtnText}>{exportFormat.toUpperCase()}</Text>
              </Pressable>

              <Pressable
                style={[styles.exportBtn, isExporting && styles.exportBtnDisabled]}
                onPress={handleSaveToGallery}
                disabled={isExporting}
              >
                {isExporting ? (
                  <ActivityIndicator color="#070A12" />
                ) : (
                  <Text style={styles.exportBtnText}>
                    Save ({cropRect.w}×{cropRect.h})
                  </Text>
                )}
              </Pressable>

              <Pressable
                style={[styles.shareBtn, isExporting && styles.exportBtnDisabled]}
                onPress={handleShareImage}
                disabled={isExporting}
              >
                <Text style={styles.shareBtnText}>Share</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : (
        <View style={{ flex: 1 }} />
      )}

      {/* Save Custom Preset Modal */}
      <Modal
        visible={saveModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Save Custom Preset</Text>
            <Text style={styles.modalSub}>
              Save your current slider & curve settings for future astrophotos.
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g., Seestar Nebula or Moon Sharp"
              placeholderTextColor="#64748B"
              value={newPresetName}
              onChangeText={setNewPresetName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setSaveModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSaveBtn} onPress={handleSaveCustomPreset}>
                <Text style={styles.modalSaveText}>Save Preset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// Interactive 5-Point Tone Curve Editor Component
function CurveEditorCard({
  curves,
  activeChannel,
  onSelectChannel,
  onChangePoint,
  onResetChannel,
  onDragStateChange,
}: {
  curves: CurvePoints;
  activeChannel: CurveChannel;
  onSelectChannel: (ch: CurveChannel) => void;
  onChangePoint: (index: number, val: number) => void;
  onResetChannel: () => void;
  onDragStateChange: (dragging: boolean) => void;
}) {
  const pts = curves[activeChannel];
  const boxWidthRef = useRef(280);
  const boxHeight = 170;
  const activeIdxRef = useRef<number>(2);

  const channelColor =
    activeChannel === 'r'
      ? '#F87171'
      : activeChannel === 'g'
      ? '#4ADE80'
      : activeChannel === 'b'
      ? '#38BDF8'
      : '#F8FAFC';

  const onChangePointRef = useRef(onChangePoint);
  const onDragRef = useRef(onDragStateChange);
  onChangePointRef.current = onChangePoint;
  onDragRef.current = onDragStateChange;

  const curvePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        onDragRef.current(true);
        const w = Math.max(1, boxWidthRef.current);
        const xRatio = Math.min(1, Math.max(0, evt.nativeEvent.locationX / w));
        // Snap selection to nearest of the 5 control points (0, 0.25, 0.5, 0.75, 1.0)
        const nearestIdx = Math.min(4, Math.max(0, Math.round(xRatio * 4)));
        activeIdxRef.current = nearestIdx;
        const yVal = 1 - Math.min(1, Math.max(0, evt.nativeEvent.locationY / boxHeight));
        onChangePointRef.current(nearestIdx, yVal);
      },
      onPanResponderMove: (evt) => {
        const yVal = 1 - Math.min(1, Math.max(0, evt.nativeEvent.locationY / boxHeight));
        onChangePointRef.current(activeIdxRef.current, yVal);
      },
      onPanResponderRelease: () => {
        onDragRef.current(false);
      },
      onPanResponderTerminate: () => {
        onDragRef.current(false);
      },
    })
  ).current;

  const pointLabels = ['Black', 'Shadows', 'Midtones', 'Highlights', 'White'];

  // Sample 25 points along the interpolated curve to draw a smooth polyline
  const curveSegments = useMemo(() => {
    const samples: { xPct: number; yPct: number }[] = [];
    for (let i = 0; i <= 24; i++) {
      const x = i / 24;
      const y = evalSpline5JS(x, pts);
      samples.push({ xPct: x * 100, yPct: (1 - y) * 100 });
    }
    return samples;
  }, [pts]);

  return (
    <View style={styles.controlsCard}>
      {/* Channel Selector + Reset */}
      <View style={styles.curveTopBar}>
        <View style={styles.curveChannelGroup}>
          {(
            [
              { id: 'rgb', label: 'RGB', color: '#F8FAFC' },
              { id: 'r', label: 'Red', color: '#F87171' },
              { id: 'g', label: 'Green', color: '#4ADE80' },
              { id: 'b', label: 'Blue', color: '#38BDF8' },
            ] as { id: CurveChannel; label: string; color: string }[]
          ).map((ch) => {
            const selected = activeChannel === ch.id;
            return (
              <Pressable
                key={ch.id}
                style={[
                  styles.channelPill,
                  selected && { borderColor: ch.color, backgroundColor: '#1E293B' },
                ]}
                onPress={() => onSelectChannel(ch.id)}
              >
                <Text style={[styles.channelPillText, { color: ch.color }]}>{ch.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.resetCurveBtn} onPress={onResetChannel}>
          <Text style={styles.resetCurveText}>Reset</Text>
        </Pressable>
      </View>

      {/* Interactive 2D Tone Curve Box */}
      <View
        pointerEvents="box-only"
        onLayout={(e) => {
          boxWidthRef.current = e.nativeEvent.layout.width;
        }}
        style={[styles.curveBox, { height: boxHeight }]}
        {...curvePanResponder.panHandlers}
      >
        {/* 4x4 Grid Lines */}
        {[25, 50, 75].map((pct) => (
          <React.Fragment key={pct}>
            <View style={[styles.gridLineV, { left: `${pct}%` }]} />
            <View style={[styles.gridLineH, { top: `${pct}%` }]} />
          </React.Fragment>
        ))}

        {/* Diagonal Linear Reference Line */}
        {Array.from({ length: 20 }).map((_, idx) => (
          <View
            key={`diag-${idx}`}
            style={{
              position: 'absolute',
              left: `${(idx / 19) * 100}%`,
              top: `${(1 - idx / 19) * 100}%`,
              width: 3,
              height: 1.5,
              backgroundColor: 'rgba(148, 163, 184, 0.25)',
            }}
          />
        ))}

        {/* Smooth Curve Dots/Line */}
        {curveSegments.map((pt, idx) => (
          <View
            key={`seg-${idx}`}
            style={{
              position: 'absolute',
              left: `${pt.xPct}%`,
              top: `${pt.yPct}%`,
              width: 5,
              height: 5,
              borderRadius: 2.5,
              marginLeft: -2.5,
              marginTop: -2.5,
              backgroundColor: channelColor,
            }}
          />
        ))}

        {/* 5 Draggable Control Handles */}
        {pts.map((val, idx) => (
          <View
            key={`node-${idx}`}
            style={[
              styles.curveHandle,
              {
                left: `${idx * 25}%`,
                top: `${(1 - val) * 100}%`,
                borderColor: channelColor,
              },
            ]}
          />
        ))}
      </View>

      {/* Numeric Readouts for the 5 Points */}
      <View style={styles.curveReadoutRow}>
        {pts.map((val, idx) => (
          <View key={idx} style={styles.curveReadoutItem}>
            <Text style={styles.curveReadoutLabel}>{pointLabels[idx]}</Text>
            <Text style={[styles.curveReadoutVal, { color: channelColor }]}>
              {Math.round(val * 100)}%
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  signed = false,
  unit = '%',
  isLast = false,
  onDragStateChange,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  signed?: boolean;
  unit?: string;
  isLast?: boolean;
  onDragStateChange?: (dragging: boolean) => void;
  onChange: (val: number) => void;
}) {
  const trackWidthRef = useRef(1);
  const minRef = useRef(min);
  const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  const onDragRef = useRef(onDragStateChange);
  minRef.current = min;
  maxRef.current = max;
  onChangeRef.current = onChange;
  onDragRef.current = onDragStateChange;

  const ratio = Math.min(1, Math.max(0, (value - min) / (max - min)));

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        onDragRef.current?.(true);
        const w = Math.max(1, trackWidthRef.current);
        const r = Math.min(1, Math.max(0, evt.nativeEvent.locationX / w));
        onChangeRef.current(minRef.current + r * (maxRef.current - minRef.current));
      },
      onPanResponderMove: (evt) => {
        const w = Math.max(1, trackWidthRef.current);
        const r = Math.min(1, Math.max(0, evt.nativeEvent.locationX / w));
        onChangeRef.current(minRef.current + r * (maxRef.current - minRef.current));
      },
      onPanResponderRelease: () => {
        onDragRef.current?.(false);
      },
      onPanResponderTerminate: () => {
        onDragRef.current?.(false);
      },
    })
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  };

  let displayVal = `${Math.round(ratio * 100)}%`;
  if (unit === '°') {
    displayVal = `${value > 0 ? '+' : ''}${value.toFixed(1)}°`;
  } else if (signed) {
    const pct = Math.round((value / max) * 100);
    displayVal = `${pct > 0 ? '+' : ''}${pct}%`;
  }

  return (
    <View style={[styles.sliderRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.sliderHeader}>
        <Text style={styles.controlLabel}>{label}</Text>
        <Text style={styles.stepVal}>{displayVal}</Text>
      </View>
      <View
        pointerEvents="box-only"
        style={styles.sliderTouchArea}
        onLayout={onTrackLayout}
        {...panResponder.panHandlers}
      >
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, { width: `${ratio * 100}%` }]} />
        </View>
        <View style={[styles.sliderThumb, { left: `${ratio * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#070A12',
  },
  pinnedTop: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: '#070A12',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  primaryBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  primaryBtnText: {
    color: '#38BDF8',
    fontWeight: '600',
    fontSize: 13,
  },
  canvasContainer: {
    backgroundColor: '#0D1322',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  viewportClip: {
    overflow: 'hidden',
    backgroundColor: '#05070D',
  },
  splitLineWrap: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  splitLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2.5,
    backgroundColor: '#38BDF8',
  },
  splitHandle: {
    backgroundColor: '#0F172A',
    borderColor: '#38BDF8',
    borderWidth: 2,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 14,
  },
  splitHandleText: {
    color: '#F8FAFC',
    fontSize: 10,
    fontWeight: '700',
  },
  histBox: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(7, 10, 18, 0.90)',
    borderColor: '#38BDF8',
    borderWidth: 1,
    borderRadius: 8,
    padding: 6,
    zIndex: 30,
  },
  histBars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 46,
    gap: 1.5,
  },
  histCol: {
    width: 3,
    height: 46,
    justifyContent: 'flex-end',
  },
  histBar: {
    position: 'absolute',
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 1,
    borderTopRightRadius: 1,
  },
  histLabel: {
    color: '#CBD5E1',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 3,
    textAlign: 'center',
  },
  viewportBar: {
    width: '100%',
    height: 40,
    paddingHorizontal: 8,
    backgroundColor: '#0B111E',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  zoomGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  barChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  barChipActive: {
    backgroundColor: '#0284C7',
  },
  barChipWarn: {
    backgroundColor: '#9A3412',
  },
  barChipText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyState: {
    padding: 28,
    alignItems: 'center',
  },
  emptyTitle: {
    color: '#E2E8F0',
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyDesc: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0B111E',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    paddingHorizontal: 8,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabBtnActive: {
    borderBottomColor: '#38BDF8',
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#38BDF8',
  },
  middleScroll: {
    flex: 1,
  },
  middleScrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 24,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  savePresetChip: {
    backgroundColor: '#132238',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  savePresetChipText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: '600',
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  presetGridCard: {
    width: '48.5%',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#1E293B',
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
  },
  presetCardActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#132238',
  },
  presetName: {
    color: '#F1F5F9',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 3,
  },
  presetNameActive: {
    color: '#38BDF8',
  },
  presetDesc: {
    color: '#94A3B8',
    fontSize: 11,
    lineHeight: 14,
  },
  controlsCard: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  curveTopBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  curveChannelGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  channelPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#070A12',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  channelPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  resetCurveBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#1E293B',
  },
  resetCurveText: {
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '600',
  },
  curveBox: {
    width: '100%',
    backgroundColor: '#050811',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    position: 'relative',
    overflow: 'hidden',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(51, 65, 85, 0.45)',
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(51, 65, 85, 0.45)',
  },
  curveHandle: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#070A12',
    borderWidth: 2.5,
    marginLeft: -8,
    marginTop: -8,
  },
  curveReadoutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  curveReadoutItem: {
    alignItems: 'center',
  },
  curveReadoutLabel: {
    color: '#64748B',
    fontSize: 10,
  },
  curveReadoutVal: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 1,
  },
  cropSectionLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 8,
  },
  aspectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  aspectChip: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  aspectChipActive: {
    backgroundColor: '#132238',
    borderColor: '#38BDF8',
  },
  aspectChipText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  aspectChipTextActive: {
    color: '#38BDF8',
  },
  sliderRow: {
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  sliderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  controlLabel: {
    color: '#CBD5E1',
    fontSize: 13,
  },
  stepVal: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 12,
  },
  sliderTouchArea: {
    height: 30,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  sliderFill: {
    height: '100%',
    backgroundColor: '#38BDF8',
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 2.5,
    borderColor: '#38BDF8',
    marginLeft: -10,
  },
  pinnedBottom: {
    paddingHorizontal: 12,
    paddingTop: 10,
    backgroundColor: '#070A12',
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  formatBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#334155',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  formatBtnText: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 12,
  },
  exportBtn: {
    flex: 1,
    backgroundColor: '#38BDF8',
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  exportBtnDisabled: {
    opacity: 0.6,
  },
  exportBtnText: {
    color: '#070A12',
    fontWeight: '700',
    fontSize: 14,
  },
  shareBtn: {
    backgroundColor: '#1E293B',
    borderColor: '#38BDF8',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  shareBtnText: {
    color: '#38BDF8',
    fontWeight: '700',
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    padding: 18,
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 14,
  },
  modalInput: {
    backgroundColor: '#070A12',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  modalCancelText: {
    color: '#CBD5E1',
    fontWeight: '600',
  },
  modalSaveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#38BDF8',
  },
  modalSaveText: {
    color: '#070A12',
    fontWeight: '700',
  },
});
