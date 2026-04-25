import { useCallback, useEffect, useRef, useState } from 'react';
import { Cpu, MemoryStick, Network } from 'lucide-react';

export const GAME_RESOURCES = [
  {
    key: 'cpu',
    label: 'CPU',
    icon: Cpu,
    color: 'text-primary',
    bg: 'bg-primary',
    baseRate: 1.0,
  },
  {
    key: 'memory',
    label: 'Memory',
    icon: MemoryStick,
    color: 'text-success',
    bg: 'bg-success',
    baseRate: 0.7,
  },
  {
    key: 'network',
    label: 'Network',
    icon: Network,
    color: 'text-warning',
    bg: 'bg-warning',
    baseRate: 1.3,
  },
] as const;

export type ResourceKey = (typeof GAME_RESOURCES)[number]['key'];

export interface GameEvent {
  id: number;
  message: string;
  type: 'success' | 'danger' | 'warning' | 'info';
}

export interface GameState {
  cpu: number;
  memory: number;
  network: number;
  stability: number;
  score: number;
  wave: number;
  elapsed: number;
  combo: number;
  comboTimer: number;
  gameOver: boolean;
  newHighScore: boolean;
  memorySpikeTimer: number;
  networkBurstTimer: number;
  networkBurstFilling: boolean;
  events: GameEvent[];
}

const TICK_MS = 100;
const INITIAL_STABILITY = 100;
const OVERFLOW_PENALTY = 20;
const FLUSH_BONUS = 25;
const MAX_EVENTS = 4;
const WAVE_DURATION_TICKS = 15 * (1000 / TICK_MS); // 15 seconds

function createInitialState(): GameState {
  return {
    cpu: 0,
    memory: 0,
    network: 0,
    stability: INITIAL_STABILITY,
    score: 0,
    wave: 1,
    elapsed: 0,
    combo: 0,
    comboTimer: 0,
    gameOver: false,
    newHighScore: false,
    memorySpikeTimer: Math.floor(Math.random() * 80) + 40,
    networkBurstTimer: 30,
    networkBurstFilling: true,
    events: [],
  };
}

function getHighScore(): number {
  try {
    return parseInt(localStorage.getItem('catalyst-404-hs') || '0', 10);
  } catch {
    return 0;
  }
}

function saveHighScore(score: number) {
  try {
    localStorage.setItem('catalyst-404-hs', String(score));
  } catch {
    // ignore
  }
}

function getRate(base: number, wave: number) {
  return base * (1 + (wave - 1) * 0.25);
}

export function useResourceBalancer() {
  const [game, setGame] = useState<GameState>(createInitialState);
  const [highScore, setHighScoreState] = useState(getHighScore);
  const [reducedMotion, setReducedMotion] = useState(false);
  const eventIdRef = useRef(0);
  const comboResetRef = useRef<number | null>(null);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mql.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (game.gameOver) return;

    const interval = window.setInterval(() => {
      setGame((prev) => {
        if (prev.gameOver) return prev;

        const wave = Math.floor(prev.elapsed / WAVE_DURATION_TICKS) + 1;
        const tickMult = reducedMotion ? 0.6 : 1;

        // CPU: steady linear fill
        const cpu = Math.min(
          100,
          prev.cpu + getRate(GAME_RESOURCES[0].baseRate, wave) * tickMult,
        );

        // Memory: slow fill with random spikes
        let memorySpikeTimer = prev.memorySpikeTimer - 1;
        let memory =
          prev.memory +
          getRate(GAME_RESOURCES[1].baseRate, wave) * tickMult;
        if (memorySpikeTimer <= 0) {
          memory = Math.min(100, memory + 22);
          memorySpikeTimer = Math.floor(Math.random() * 100) + 50;
        }

        // Network: burst pattern (fill for 3s, rest for 2s)
        let networkBurstTimer = prev.networkBurstTimer - 1;
        let networkBurstFilling = prev.networkBurstFilling;
        if (networkBurstTimer <= 0) {
          networkBurstFilling = !networkBurstFilling;
          networkBurstTimer = networkBurstFilling ? 30 : 20;
        }
        const networkRate = networkBurstFilling
          ? getRate(GAME_RESOURCES[2].baseRate, wave) * tickMult
          : getRate(GAME_RESOURCES[2].baseRate, wave) * 0.12 * tickMult;
        const network = Math.min(100, prev.network + networkRate);

        // Overflow handling
        let stability = prev.stability;
        const events = [...prev.events];

        if (cpu >= 100) {
          stability -= OVERFLOW_PENALTY;
          events.unshift({
            id: ++eventIdRef.current,
            message: 'CPU overload detected',
            type: 'danger',
          });
        }
        if (memory >= 100) {
          stability -= OVERFLOW_PENALTY;
          events.unshift({
            id: ++eventIdRef.current,
            message: 'Memory spike overflow',
            type: 'danger',
          });
        }
        if (network >= 100) {
          stability -= OVERFLOW_PENALTY;
          events.unshift({
            id: ++eventIdRef.current,
            message: 'Network throughput exceeded',
            type: 'danger',
          });
        }

        // Score & combo
        const score = prev.score + 1;
        const comboTimer = Math.max(0, prev.comboTimer - 1);
        const combo = comboTimer > 0 ? prev.combo : 0;

        const clampedStability = Math.max(0, stability);
        const isGameOver = clampedStability <= 0;

        let newHighScore = false;
        if (isGameOver) {
          const hs = getHighScore();
          if (score > hs) {
            saveHighScore(score);
            newHighScore = true;
          }
        }

        return {
          cpu: cpu >= 100 ? 0 : cpu,
          memory: memory >= 100 ? 0 : memory,
          network: network >= 100 ? 0 : network,
          stability: clampedStability,
          score,
          wave,
          elapsed: prev.elapsed + 1,
          combo,
          comboTimer,
          gameOver: isGameOver,
          newHighScore,
          memorySpikeTimer,
          networkBurstTimer,
          networkBurstFilling,
          events: events.slice(0, MAX_EVENTS),
        };
      });
    }, TICK_MS);

    return () => window.clearInterval(interval);
  }, [game.gameOver, reducedMotion]);

  useEffect(() => {
    if (game.gameOver && game.newHighScore) {
      setHighScoreState(game.score);
    }
  }, [game.gameOver, game.newHighScore, game.score]);

  const flush = useCallback((key: ResourceKey) => {
    setGame((prev) => {
      if (prev.gameOver) return prev;

      const now = Date.now();
      const isCombo =
        comboResetRef.current !== null && now - comboResetRef.current < 1000;
      const combo = isCombo ? prev.combo + 1 : 1;
      comboResetRef.current = now;

      const comboBonus = combo > 1 ? combo * 5 : 0;
      const label = GAME_RESOURCES.find((r) => r.key === key)?.label ?? key;

      const events = [
        {
          id: ++eventIdRef.current,
          message: `${label} flushed${combo > 1 ? ` — ${combo}x combo` : ''}`,
          type: 'success' as const,
        },
        ...prev.events,
      ].slice(0, MAX_EVENTS);

      return {
        ...prev,
        [key]: 0,
        score: prev.score + FLUSH_BONUS + comboBonus,
        combo,
        comboTimer: 15,
        events,
      };
    });
  }, []);

  const reset = useCallback(() => {
    comboResetRef.current = null;
    eventIdRef.current = 0;
    setGame(createInitialState());
  }, []);

  return {
    game,
    highScore,
    flush,
    reset,
    reducedMotion,
    resources: GAME_RESOURCES,
  };
}
