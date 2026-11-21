export interface AstroPreset {
  id: string;
  name: string;
  description: string;
  params: AstroParams;
}

export interface AstroParams {
  stretch: number;      // 0.0 to 1.0 (Asinh midtone stretch for faint nebulosity)
  blackPoint: number;   // 0.0 to 0.35 (Clips light pollution floor)
  sharpen: number;      // 0.0 to 1.5 (Unsharp mask for lunar/planetary detail)
  denoise: number;      // 0.0 to 1.0 (Chroma/background noise suppression)
  vibrance: number;     // 0.0 to 1.5 (Emission nebula & star color boost)
  skyNeutral: number;   // 0.0 to 1.0 (Neutralizes orange/green light pollution)
}

export const ASTRO_PRESETS: AstroPreset[] = [
  {
    id: 'auto_deep_sky',
    name: 'Auto Deep Sky',
    description: 'Balanced stretch & skyglow removal for nebulas & galaxies',
    params: {
      stretch: 0.62,
      blackPoint: 0.08,
      sharpen: 0.35,
      denoise: 0.45,
      vibrance: 0.65,
      skyNeutral: 0.75,
    },
  },
  {
    id: 'nebula_boost',
    name: 'Nebula (H-Alpha)',
    description: 'Aggressive faint-detail stretch & emission color separation',
    params: {
      stretch: 0.78,
      blackPoint: 0.11,
      sharpen: 0.4,
      denoise: 0.55,
      vibrance: 0.95,
      skyNeutral: 0.85,
    },
  },
  {
    id: 'planetary_lunar',
    name: 'Moon & Planets',
    description: 'High micro-contrast & crater/band sharpening without over-stretching',
    params: {
      stretch: 0.18,
      blackPoint: 0.04,
      sharpen: 1.15,
      denoise: 0.25,
      vibrance: 0.35,
      skyNeutral: 0.2,
    },
  },
  {
    id: 'galaxy_core',
    name: 'Galaxy HDR',
    description: 'Reveals outer dust lanes while protecting bright galactic cores',
    params: {
      stretch: 0.55,
      blackPoint: 0.09,
      sharpen: 0.55,
      denoise: 0.4,
      vibrance: 0.5,
      skyNeutral: 0.8,
    },
  },
  {
    id: 'original',
    name: 'Original',
    description: 'Unprocessed raw input frame',
    params: {
      stretch: 0.0,
      blackPoint: 0.0,
      sharpen: 0.0,
      denoise: 0.0,
      vibrance: 0.0,
      skyNeutral: 0.0,
    },
  },
];

// GPU Runtime Shader (SkSL)
export const ASTRO_SKSL_SHADER = `
uniform shader image;
uniform float2 resolution;
uniform float stretch;
uniform float blackPoint;
uniform float sharpen;
uniform float denoise;
uniform float vibrance;
uniform float skyNeutral;

float getLuma(half3 c) {
  return dot(float3(c), float3(0.2126, 0.7152, 0.0722));
}

// Inverse hyperbolic sine stretch (standard in astrophotography to preserve star cores)
float asinhStretch(float x, float beta) {
  if (beta <= 0.001) return x;
  float b = beta * 12.0;
  return log(b * x + sqrt(b * b * x * x + 1.0)) / log(b + sqrt(b * b + 1.0));
}

half4 main(float2 xy) {
  half4 center = image.eval(xy);
  float3 rgb = float3(center.rgb);

  // Sample 3x3 neighborhood for sharpening & background denoising
  float3 n  = float3(image.eval(xy + float2( 0.0, -1.0)).rgb);
  float3 s  = float3(image.eval(xy + float2( 0.0,  1.0)).rgb);
  float3 e  = float3(image.eval(xy + float2( 1.0,  0.0)).rgb);
  float3 w  = float3(image.eval(xy + float2(-1.0,  0.0)).rgb);
  float3 nw = float3(image.eval(xy + float2(-1.0, -1.0)).rgb);
  float3 ne = float3(image.eval(xy + float2( 1.0, -1.0)).rgb);
  float3 sw = float3(image.eval(xy + float2(-1.0,  1.0)).rgb);
  float3 se = float3(image.eval(xy + float2( 1.0,  1.0)).rgb);

  float3 blur = (n + s + e + w) * 0.15 + (nw + ne + sw + se) * 0.10;
  float luma = getLuma(half3(rgb));

  // 1. Shadow-targeted denoising (smooths noisy sky background, preserves bright stars)
  float shadowMask = 1.0 - smoothstep(0.05, 0.35, luma);
  rgb = mix(rgb, blur, denoise * shadowMask * 0.75);

  // 2. Unsharp mask for lunar craters, planetary bands, and nebula filaments
  float3 detail = rgb - blur;
  float detailMask = smoothstep(0.03, 0.25, luma);
  rgb += detail * sharpen * detailMask * 1.4;

  // 3. Light pollution neutralization (balances low-luminance color cast toward neutral dark sky)
  if (skyNeutral > 0.001) {
    float bgWeight = (1.0 - smoothstep(0.04, 0.28, luma)) * skyNeutral;
    float meanChannel = (rgb.r + rgb.g + rgb.b) / 3.0;
    rgb = mix(rgb, float3(meanChannel * 0.92), bgWeight * 0.65);
  }

  // 4. Black point clipping (sets true dark space floor)
  rgb = max(rgb - float3(blackPoint), float3(0.0)) / max(1.0 - blackPoint, 0.01);

  // 5. Asinh non-linear histogram stretch
  float stretchedLuma = asinhStretch(getLuma(half3(rgb)), stretch);
  float origLuma = max(getLuma(half3(rgb)), 0.0001);
  float ratio = stretchedLuma / origLuma;
  // Blend luminance-preserving stretch with per-channel stretch to avoid washed-out highlights
  float3 lumPreserved = rgb * ratio;
  float3 perChannel = float3(
    asinhStretch(rgb.r, stretch),
    asinhStretch(rgb.g, stretch),
    asinhStretch(rgb.b, stretch)
  );
  rgb = mix(lumPreserved, perChannel, 0.35);

  // 6. Astro Vibrance (boosts muted nebula/star colors without clipping bright cores)
  float finalLuma = getLuma(half3(rgb));
  float maxC = max(rgb.r, max(rgb.g, rgb.b));
  float minC = min(rgb.r, min(rgb.g, rgb.b));
  float sat = maxC - minC;
  float vibranceGain = vibrance * (1.0 - sat) * smoothstep(0.03, 0.2, finalLuma);
  rgb = mix(float3(finalLuma), rgb, 1.0 + vibranceGain);

  return half4(clamp(rgb, 0.0, 1.0), center.a);
}
`;
