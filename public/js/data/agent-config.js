export const AGENT_DEFAULTS = {
  enabled: false,
  mode: 'standard',
  agentModel: '',
  criticModel: '',
  autoUpgrade: false,
  maxConcurrency: 10
};

export function getAgentConfig() {
  try {
    const raw = localStorage.getItem('naruto_agent_config');
    if (raw) return { ...AGENT_DEFAULTS, ...JSON.parse(raw) };
  } catch {}
  return { ...AGENT_DEFAULTS };
}

export function saveAgentConfig(config) {
  localStorage.setItem('naruto_agent_config', JSON.stringify({ ...AGENT_DEFAULTS, ...config }));
}
