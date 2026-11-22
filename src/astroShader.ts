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
  denoise: number;      // 0.0 to 1.0 (Chroma & background grain smoothing)
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
      denoise: 0.65,
      vibrance: 0.45,
      starControl: 0.7,
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
      denoise: 0.75,
      vibrance: 0.6,
      starControl: 0.8,
    },
  },
  {
    id: 'galaxy',
    name: 'Galaxies',
    description: 'Reveals faint spiral arms & dust lanes without blowing out cores',
    params: {
      stretch: 0.55,
      blackPoint: 0.09,
      sharpen: 0.55,
      denoise: 0.7,
      vibrance: 0.42,
      starControl: 0.75,
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

// GPU Runtime Shader (SkSL) - Clean Chroma-Stabilized Astrophotography Pipeline
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

  // Sample 3x3 immediate neighbors + 2px cardinal neighbors for clean chroma & hot-pixel suppression
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
  float3 wideBlur = blur3 * 0.6 + (n2 + s2 + e2 + w2) * 0.10;

  float luma = getLuma(rgb);
  float blurLuma = getLuma(blur3);

  // 1. Hot-pixel & Chroma Speckle Suppression (eliminates isolated red/blue pixel blotches)
  // If a single pixel's color differs sharply from the wider neighborhood while luminance is low,
  // replace its chrominance with the smooth wide neighborhood chrominance.
  float wideLuma = getLuma(wideBlur);
  float3 centerChroma = rgb - float3(luma);
  float3 wideChroma = wideBlur - float3(wideLuma);
  float chromaSpike = length(centerChroma - wideChroma);
  float darkChromaMask = (1.0 - smoothstep(0.05, 0.35, luma)) * clamp(denoise * 1.15 + smoothstep(0.03, 0.14, chromaSpike), 0.0, 1.0);
  float3 cleanChroma = mix(centerChroma, wideChroma, darkChromaMask * 0.92);
  rgb = max(float3(luma) + cleanChroma, float3(0.0));

  // Re-evaluate star detection after chroma cleanup
  float localPeak = max(0.0, luma - blurLuma);
  float starMask = clamp(smoothstep(0.06, 0.26, localPeak) + smoothstep(0.75, 0.96, luma), 0.0, 1.0);

  // 2. Luminance-Based Star Tightening (shrinks star halos without shifting RGB hue)
  if (starControl > 0.001) {
    float minLuma = min(
      min(min(getLuma(n), getLuma(s)), min(getLuma(e), getLuma(w))),
      min(min(getLuma(nw), getLuma(ne)), min(getLuma(sw), getLuma(se)))
    );
    float haloZone = smoothstep(0.03, 0.18, localPeak) * (1.0 - smoothstep(0.25, 0.55, localPeak));
    float targetStarLuma = mix(luma, min(luma, mix(blurLuma, minLuma, 0.45)), starControl * haloZone * 0.65);
    if (luma > 0.0001) {
      rgb *= (targetStarLuma / luma);
      luma = targetStarLuma;
    }
  }

  // 3. Luminance Background Smoothing (smooths grainy dark sky while preserving nebula edges)
  if (denoise > 0.001) {
    float edgeDiff = abs(luma - blurLuma);
    float flatMask = (1.0 - smoothstep(0.015, 0.14, edgeDiff)) * (1.0 - starMask);
    float smoothLuma = mix(luma, blurLuma, denoise * flatMask * 0.85);
    if (luma > 0.0001) {
      rgb *= (smoothLuma / luma);
      luma = smoothLuma;
    }
  }

  // 4. Structure Sharpening (nebula filaments, galaxy dust lanes, lunar craters & solar granules)
  if (sharpen > 0.001) {
    float lumaDetail = luma - blurLuma;
    float nonStarMask = (1.0 - starMask) * smoothstep(0.025, 0.15, luma);
    float sharpLuma = max(0.0, luma + lumaDetail * sharpen * nonStarMask * 1.55);
    if (luma > 0.0001) {
      rgb *= (sharpLuma / luma);
    }
  }

  // 5. Black Point Floor (subtracts skyglow cleanly)
  if (blackPoint > 0.001) {
    float neutralFloor = blackPoint * 0.85;
    rgb = max(rgb - float3(neutralFloor), float3(0.0)) / max(1.0 - neutralFloor, 0.05);
  }

  // 6. Pure Luminance-Preserving Asinh Stretch
  if (stretch > 0.001) {
    float curLuma = getLuma(rgb);
    if (curLuma > 0.0001) {
      float targetLuma = asinhCurve(curLuma, stretch);
      targetLuma = mix(targetLuma, curLuma, smoothstep(0.65, 0.98, curLuma) * 0.6);
      rgb *= (targetLuma / curLuma);
    }
  }

  // 7. Shadow Chroma Suppression + Midtone-Only Vibrance
  // Keeps dark background sky neutral (prevents amplified red/blue noise blotches)
  // while enriching midtone nebula/planetary colors.
  float postLuma = getLuma(rgb);
  float shadowNeutralize = 1.0 - smoothstep(0.02, 0.11, postLuma);
  rgb = mix(rgb, float3(postLuma), shadowNeutralize * 0.85);

  if (vibrance > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float sat = maxC - minC;
    float midtoneMask = smoothstep(0.07, 0.24, postLuma) * (1.0 - smoothstep(0.50, 0.78, postLuma)) * (1.0 - starMask);
    float gain = vibrance * (1.0 - sat) * midtoneMask * 1.05;
    rgb = mix(float3(postLuma), rgb, 1.0 + gain);
  }

  // 8. Natural White Star Core Recovery
  float finalLuma = getLuma(rgb);
  float coreWhiteMask = smoothstep(0.60, 0.90, finalLuma) * mix(0.45, 1.0, starControl);
  float starColorTame = starMask * starControl * 0.60;
  rgb = mix(rgb, float3(finalLuma), clamp(coreWhiteMask + starColorTame, 0.0, 0.96));

  return half4(clamp(rgb, 0.0, 1.0), center.a);
}
`;
