export interface AstroPreset {
  id: string;
  name: string;
  description: string;
  params: AstroParams;
}

export interface AstroParams {
  stretch: number;      // 0.0 to 1.0 (Midtone / Asinh stretch)
  blackPoint: number;   // 0.0 to 0.40 (Sky background floor)
  sharpen: number;      // 0.0 to 1.5 (Structure & surface detail)
  denoise: number;      // 0.0 to 1.0 (Background grain smoothing)
  vibrance: number;     // 0.0 to 1.5 (Natural midtone color)
  starControl: number;  // 0.0 to 1.0 (Star bloat reduction & white-core recovery)
}

export const ASTRO_PRESETS: AstroPreset[] = [
  {
    id: 'auto_pro',
    name: 'Auto Pro',
    description: 'Analyzes your photo brightness & sets natural balanced levels',
    params: {
      stretch: 0.45,
      blackPoint: 0.06,
      sharpen: 0.45,
      denoise: 0.45,
      vibrance: 0.45,
      starControl: 0.65,
    },
  },
  {
    id: 'deep_sky_natural',
    name: 'Nebula & Galaxy',
    description: 'Reveals faint dust & gas while keeping pinpoint natural stars',
    params: {
      stretch: 0.65,
      blackPoint: 0.08,
      sharpen: 0.4,
      denoise: 0.55,
      vibrance: 0.55,
      starControl: 0.75,
    },
  },
  {
    id: 'lunar_solar',
    name: 'Moon & Sun',
    description: 'Crisp craters, maria & solar granulation with controlled highlights',
    params: {
      stretch: 0.2,
      blackPoint: 0.03,
      sharpen: 1.05,
      denoise: 0.3,
      vibrance: 0.25,
      starControl: 0.3,
    },
  },
  {
    id: 'planetary',
    name: 'Planets',
    description: 'Enhances cloud bands, rings & surface contrast without ringing',
    params: {
      stretch: 0.25,
      blackPoint: 0.05,
      sharpen: 1.2,
      denoise: 0.4,
      vibrance: 0.4,
      starControl: 0.2,
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

// GPU Runtime Shader (SkSL) - Natural Astrophotography Pipeline
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

// Luminance-preserving inverse hyperbolic sine stretch (prevents star color shifts)
float asinhCurve(float x, float amount) {
  if (amount <= 0.001) return x;
  float b = amount * 10.0;
  return log(b * x + sqrt(b * b * x * x + 1.0)) / log(b + sqrt(b * b + 1.0));
}

half4 main(float2 xy) {
  half4 center = image.eval(xy);
  float3 rgb = float3(center.rgb);

  // Sample 3x3 neighborhood
  float3 n  = float3(image.eval(xy + float2( 0.0, -1.0)).rgb);
  float3 s  = float3(image.eval(xy + float2( 0.0,  1.0)).rgb);
  float3 e  = float3(image.eval(xy + float2( 1.0,  0.0)).rgb);
  float3 w  = float3(image.eval(xy + float2(-1.0,  0.0)).rgb);
  float3 nw = float3(image.eval(xy + float2(-1.0, -1.0)).rgb);
  float3 ne = float3(image.eval(xy + float2( 1.0, -1.0)).rgb);
  float3 sw = float3(image.eval(xy + float2(-1.0,  1.0)).rgb);
  float3 se = float3(image.eval(xy + float2( 1.0,  1.0)).rgb);

  float3 blur = (n + s + e + w) * 0.15 + (nw + ne + sw + se) * 0.10;
  float luma = getLuma(rgb);
  float blurLuma = getLuma(blur);

  // Detect pinpoint star spikes (local peak much brighter than surrounding neighborhood)
  float localPeak = max(0.0, luma - blurLuma);
  float starMask = clamp(smoothstep(0.06, 0.28, localPeak) + smoothstep(0.75, 0.96, luma), 0.0, 1.0);

  // 1. Morphological Star Tightening (reduces star bloat & halo diameter)
  if (starControl > 0.001) {
    float3 minNeighbor = min(min(min(n, s), min(e, w)), min(min(nw, ne), min(sw, se)));
    float haloZone = smoothstep(0.03, 0.18, localPeak) * (1.0 - smoothstep(0.25, 0.55, localPeak));
    rgb = mix(rgb, min(rgb, mix(blur, minNeighbor, 0.45)), starControl * haloZone * 0.65);
  }

  // 2. Edge-aware Background Denoising (clearly visible on noisy sky backgrounds)
  if (denoise > 0.001) {
    float edgeDiff = length(rgb - blur);
    float flatMask = 1.0 - smoothstep(0.02, 0.18, edgeDiff);
    rgb = mix(rgb, blur, denoise * flatMask * 0.85);
  }

  // 3. Structure Sharpening (applied to nebula filaments, lunar craters & planets, masked off stars)
  if (sharpen > 0.001) {
    float3 detail = rgb - blur;
    float nonStarMask = (1.0 - starMask) * smoothstep(0.02, 0.15, luma);
    rgb += detail * sharpen * nonStarMask * 1.6;
  }

  // 4. Black Point & Sky Neutralization (subtracts light pollution floor cleanly)
  if (blackPoint > 0.001) {
    float bgLum = min(rgb.r, min(rgb.g, rgb.b));
    float neutralFloor = blackPoint * 0.85;
    rgb = max(rgb - float3(neutralFloor), float3(0.0)) / max(1.0 - neutralFloor, 0.05);
  }

  // 5. Pure Luminance-Preserving Asinh Stretch (never shifts RGB ratios into orange/blue)
  if (stretch > 0.001) {
    float curLuma = getLuma(rgb);
    if (curLuma > 0.0001) {
      float targetLuma = asinhCurve(curLuma, stretch);
      // Protect highlights from clipping
      targetLuma = mix(targetLuma, curLuma, smoothstep(0.65, 0.98, curLuma) * 0.6);
      rgb *= (targetLuma / curLuma);
    }
  }

  // 6. Midtone-Only Vibrance (enhances faint nebula/planetary colors, zero boost on stars)
  float postLuma = getLuma(rgb);
  if (vibrance > 0.001) {
    float maxC = max(rgb.r, max(rgb.g, rgb.b));
    float minC = min(rgb.r, min(rgb.g, rgb.b));
    float sat = maxC - minC;
    // Bell-curve mask: strongest in midtones (0.12 - 0.60), zero in shadows and bright stars
    float midtoneMask = smoothstep(0.04, 0.22, postLuma) * (1.0 - smoothstep(0.50, 0.78, postLuma)) * (1.0 - starMask);
    float gain = vibrance * (1.0 - sat) * midtoneMask * 1.1;
    rgb = mix(float3(postLuma), rgb, 1.0 + gain);
  }

  // 7. Natural White Star Core Recovery (desaturates bright star cores & chromatic fringes)
  float finalLuma = getLuma(rgb);
  float coreWhiteMask = smoothstep(0.62, 0.92, finalLuma) * mix(0.45, 1.0, starControl);
  // Also tame chromatic aberration halos on medium-bright stars
  float starColorTame = starMask * starControl * 0.55;
  rgb = mix(rgb, float3(finalLuma), clamp(coreWhiteMask + starColorTame, 0.0, 0.95));

  return half4(clamp(rgb, 0.0, 1.0), center.a);
}
`;
