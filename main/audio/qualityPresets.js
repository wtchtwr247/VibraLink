const QUALITY_PRESETS = {
  lowLatency: {
    id: "lowLatency",
    label: "Low latency",
    description: "128 kbps Opus, tighter packets, fastest recovery.",
    bitrate: 128000,
    maxBitrate: 128000,
    minBitrate: 96000,
    opusPtime: 10,
    maxPlaybackDelayHint: 0.08,
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    description: "160 kbps Opus, stable real-time monitoring.",
    bitrate: 160000,
    maxBitrate: 160000,
    minBitrate: 128000,
    opusPtime: 20,
    maxPlaybackDelayHint: 0.12,
  },
  highQuality: {
    id: "highQuality",
    label: "High quality",
    description: "256 kbps Opus, best fidelity with a small latency tradeoff.",
    bitrate: 256000,
    maxBitrate: 256000,
    minBitrate: 160000,
    opusPtime: 20,
    maxPlaybackDelayHint: 0.16,
  },
};

function getQualityPreset(qualityMode = "balanced") {
  return QUALITY_PRESETS[qualityMode] || QUALITY_PRESETS.balanced;
}

module.exports = {
  QUALITY_PRESETS,
  getQualityPreset,
};
