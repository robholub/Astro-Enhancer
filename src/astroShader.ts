export interface AstroPreset {
  id: string;
  name: string;
  description: string;
  params: AstroParams;
}

export interface AstroParams {
  stretch: number;      // 0.0 to 1.0 (Midtone / Asinh stretch)
  blackPoint: number;   // 0.0 to 0.35 (Sky background floor)
  sharpen: number;      // 0.0 to 1.5 (Structure & surface detail)
  denoise: number;      // 0.0 to 1.0 (Hot-pixel, chroma & background grain smoothing)
  vibrance: number;     // 0.0 to 1.5 (Natural midtone color)
  starControl: number;  // 0.0 to 1.0 (Star bloat reduction & white-core recovery)
}

export const ASTRO_PRESETS: AstroPreset[] = [
  {
    id: 'auto_pro',
    name: 'Auto Pro',
    description: 'Analyzes histogram & sets natural balanced levels',
    params: {
      stretch: 0.45,
      blackPoint: 0.06,
      sharpen: 0.45,
      denoise: 0.7,
      vibrance: 0.42,
      starControl: 0.75,
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    description: 'Brings out faint H-alpha & OIII gas clouds cleanly',
    params: {
      stretch: 0.65,
      blackPoint: 0.08,
      sharpen: 0.4,
      denoise: 0.8,
      vibrance: 0.58,
      starControl: 0.8,
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxies',
    description: 'Reveals faint spiral arms & dust lanes without blowing out cores',
    params: {
      stretch: 0.52,
      blackPoint: 0.08,
      sharpen: 0.52,
      denoise: 0.78,
      vibrance: 0.38,
      starControl: 0.78,
    },
  },
  {
    id: 'moon',
    name: 'Moon',
    description: 'Crisp crater rims, ejecta rays & mare contrast',
    params: {
      stretch: 0.16,
      blackPoint: 0.04,
      sharpen: 1.15,
      denoise: 0.35,
      vibrance: 0.15,
      starControl: 0.1,
    },
  },
  {
    id: 'sun',
    name: 'Sun',
    description: 'Enhances solar granulation, sunspots & prominences',
    params: {
      stretch: 0.22,
      blackPoint: 0.05,
      sharpen: 1.05,
      denoise: 0.4,
      vibrance: 0.45,
      starControl: 0.15,
    },
  },
  {
    id: 'planets',
    name: 'Planets',
    description: 'Sharpens cloud bands, storms & ring divisions',
    params: {
      stretch: 0.24,
      blackPoint: 0.05,
      sharpen: 1.25,
      denoise: 0.5,
      vibrance: 0.4,
      starControl: 0.15,
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
      starControl: 0.0,
    },
  },
];

// GPU Runtime Shader (SkSL) - Cosmetic Hot-Pixel Rejection + Natural Astro Pipeline
export const ASTRO_SKSL_SHADER = `
uniform shader image;
uniform float2 resolution;
uniform float stretch;
uniform float blackPoint;
uniform float sharpen;
uniform float denoise;
uniform float vibrance;
uniform float starControl;

float getLuma(float3 c) {
  return dot(c, float3(0.2126, 0.7152, 0.0722));
}

float asinhCurve(float x, float amount) {
  if (amount <= 0.001) return x;
  float b = amount * 10.0;
  return log(b * x + sqrt(b * b * x * x + 1.0)) / log(b + sqrt(b * b + 1.0));
}

half4 main(float2 xy) {
  half4 center = image.eval(xy);
  float3 rgb = float3(center.rgb);

  // Sample 3x3 immediate neighbors + 2px ring for hot-pixel & chroma blotch suppression
  float3 n  = float3(image.eval(xy + float2( 0.0, -1.0)).rgb);
  float3 s  = float3(image.eval(xy + float2( 0.0,  1.0)).rgb);
  float3 e  = float3(image.eval(xy + float2( 1.0,  0.0)).rgb);
  float3 w  = float3(image.eval(xy + float2(-1.0,  0.0)).rgb);
  float3 nw = float3(image.eval(xy + float2(-1.0, -1.0)).rgb);
  float3 ne = float3(image.eval(xy + float2( 1.0, -1.0)).rgb);
  float3 sw = float3(image.eval(xy + float2(-1.0,  1.0)).rgb);
  float3 se = float3(image.eval(xy + float2( 1.0,  1.0)).rgb);

  float3 n2 = float3(image.eval(xy + float2( 0.0, -2.0)).rgb);
  float3 s2 = float3(image.eval(xy + float2( 0.0,  2.0)).rgb);
  float3 e2 = float3(image.eval(xy + float2( 2.0,  0.0)).rgb);
  float3 w2 = float3(image.eval(xy + float2(-2.0,  0.0)).rgb);

  float3 blur3 = (n + s + e + w) * 0.15 + (nw + ne + sw + se) * 0.10;
  float3 wideBlur = blur3 * 0.55 + (n2 + s2 + e2 + w2) * 0.1125;

  // 1. Single-Pixel Hot Pixel & Cold Pixel Cosmetic Rejection
  // Real stars illuminate multiple adjacent pixels; a hot pixel is an isolated spike above all 8 neighbors.
  float3 maxNeighbor = max(max(max(n, s), max(e, w)), max(max(nw, ne), max(sw, se)));
  float3 minNeighbor = min(min(min(n, s), min(e, w)), min(min(nw, ne), min(sw, se)));

  // Also check 2nd-brightest cardinal neighbor to catch 2-pixel warm/hot clusters
  float3 cardMax1 = max(max(n, s), max(e, w));
  float3 cardMin1 = min(min(n, s), min(e, w));
  float3 upperBound = maxNeighbor * 1.12;
  float3 lowerBound = minNeighbor * 0.85;

  if (denoise > 0.001) {
    // Clamp isolated per-channel spikes (removes red/blue/green hot pixels completely)
    float3 clampedRgb = clamp(rgb, lowerBound, upperBound);
    // Extra suppression for isolated chroma spikes where one channel jumps far above its neighbors
    float3 neighborSpan = max(maxNeighbor - minNeighbor, float3(0.015));
    float3 outlierScore = max(float3(0.0), rgb - maxNeighbor) / neighborSpan;
    float hotMask = clamp(max(outlierScore.r, max(outlierScore.g, outlierScore.b)) * 0.75, 0.0, 1.0);
    rgb = mix(rgb, mix(clampedRgb, blur3, hotMask), clamp(denoise * 1.25, 0.0, 1.0));
  }

  float luma = getLuma(rgb);
  float blurLuma = getLuma(blur3);

  // 2. Wide Chroma Blotch Suppression (eliminates purple/blue/red color mottling in faint galaxy/nebula arms)
  float wideLuma = getLuma(wideBlur);
  float3 centerChroma = rgb - float3(luma);
  float3 wideChroma = wideBlur - float3(wideLuma);
  float chromaDiff = length(centerChroma - wideChroma);
  float chromaSuppress = clamp(denoise * 0.9 + smoothstep(0.025, 0.12, chromaDiff) * 0.65, 0.0, 0.96);
  // Keep strong chroma suppression up to mid-highlights so faint blue/red blotches disappear
  chromaSuppress *= (1.0 - smoothstep(0.45, 0.78, luma));
  rgb = max(float3(luma) + mix(centerChroma, wideChroma, chromaSuppress), float3(0.0));

  // Star detection
  float localPeak = max(0.0, luma - blurLuma);
  float starMask = clamp(smoothstep(0.05, 0.24, localPeak) + smoothstep(0.72, 0.95, luma), 0.0, 1.0);

  // 3. Luminance-Based Star Tightening (shrinks star halos without shifting RGB hue)
  if (starControl > 0.001) {
    float minLuma = getLuma(minNeighbor);
    float haloZone = smoothstep(0.03, 0.18, localPeak) * (1.0 - smoothstep(0.25, 0.55, localPeak));
    float targetStarLuma = mix(luma, min(luma, mix(blurLuma, minLuma, 0.45)), starControl * haloZone * 0.65);
    if (luma > 0.0001) {
      rgb *= (targetStarLuma / luma);
      luma = targetStarLuma;
    }
  }

  // 4. Luminance Background Smoothing
  if (denoise > 0.001) {
    float edgeDiff = abs(luma - blurLuma);
    float flatMask = (1.0 - smoothstep(0.015, 0.14, edgeDiff)) * (1.0 - starMask);
    float smoothLuma = mix(luma, blurLuma, denoise * flatMask * 0.85);
    if (luma > 0.0001) {
      rgb *= (smoothLuma / luma);
      luma = smoothLuma;
    }
  }

  // 5. Structure Sharpening (masked off stars and noisy background)
  if (sharpen > 0.001) {
    float lumaDetail = luma - blurLuma;
    float nonStarMask = (1.0 - starMask) * smoothstep(0.035, 0.16, luma);
    float sharpLuma = max(0.0, luma + lumaDetail * sharpen * nonStarMask * 1.5);
    if (luma > 0.0001) {
      rgb *= (sharpLuma / luma);
    }
  }

  // 6. Black Point Floor
  if (blackPoint > 0.001) {
    float neutralFloor = blackPoint * 0.85;
    rgb = max(rgb - float3(neutralFloor), float3(0.0)) / max(1.0 - neutralFloor, 0.05);
  }

  // 7. Pure Luminance-Preserving Asinh Stretch
  if (stretch > 0.001) {
    float curLuma = getLuma(rgb);
    if (curLuma > 0.0001) {
      float targetLuma = asinhCurve(curLuma, stretch);
      targetLuma = mix(targetLuma, curLuma, smoothstep(0.65, 0.98, curLuma) * 0.6);
      rgb *= (targetLuma / curLuma);
    }
  }

  // 8. Shadow Chroma Neutralization + Midtone-Only Vibrance
  float postLuma = getLuma(rgb);
  float shadowNeutralize = 1.0 - smoothstep(0.03, 0.14, postLuma);
  rgb = mix(rgb, float3(postLuma), shadowNeutralize * 0.92);

  if (vibrance > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float sat = maxC - minC;
    float midtoneMask = smoothstep(0.09, 0.26, postLuma) * (1.0 - smoothstep(0.48, 0.76, postLuma)) * (1.0 - starMask);
    float gain = vibrance * (1.0 - sat) * midtoneMask * 1.0;
    rgb = mix(float3(postLuma), rgb, 1.0 + gain);
  }

  // 9. Natural White Star Core & Chromatic Fringe Recovery
  float finalLuma = getLuma(rgb);
  float coreWhiteMask = smoothstep(0.58, 0.88, finalLuma) * mix(0.5, 1.0, starControl);
  float starColorTame = starMask * starControl * 0.68;
  rgb = mix(rgb, float3(finalLuma), clamp(coreWhiteMask + starColorTame, 0.0, 0.97));

  return half4(clamp(rgb, 0.0, 1.0), center.a);
}
`;
