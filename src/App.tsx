/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Play, RotateCcw, Shield, Zap, Target, RefreshCw, LogOut, LogIn, User as UserIcon } from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  setDoc, 
  doc, 
  serverTimestamp, 
  getDoc,
  getDocFromServer
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  loginWithGoogle, 
  logout, 
  handleFirestoreError, 
  OperationType 
} from './lib/firebase';

// --- Constants ---
const RANDOM_NAMES = [
  "Ace", "Blitz", "Cipher", "Drift", "Echo", "Falcon", "Ghost", "Hunter", 
  "Icarus", "Jynx", "Koda", "Lumen", "Misty", "Nova", "Orion", "Pulse", 
  "Quantum", "Raven", "Shadow", "Titan", "Vortex", "Warp", "Xenon", "Yonder", "Zenith"
];

const generateRandomName = () => {
  const name = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${name}_${num}`;
};

const PLAYER_RADIUS = 12;
const INITIAL_SPAWN_RATE = 1000; // ms
const MIN_SPAWN_RATE = 200;
const SPEED_INCREMENT = 0.018; // Further reduced for better curve
const BASE_PROJECTILE_SPEED = 1.44; 
const KEYBOARD_SPEED = 10; 

const SKINS = [
  { id: 'default', color: '#6366f1', secondary: '#818cf8', name: 'Indigo', icon: '✨' },
  { id: 'green', color: '#22c55e', secondary: '#4ade80', name: 'Emerald', icon: '🌿' },
  { id: 'pink', color: '#ec4899', secondary: '#f472b6', name: 'Rose', icon: '💖' },
  { id: 'cyan', color: '#06b6d4', secondary: '#22d3ee', name: 'Cyan', icon: '💎' },
  { id: 'gold', color: '#eab308', secondary: '#facc15', name: 'Gold', icon: '👑' },
];

const THEMES = [
  { id: 'space', name: 'Deep Space', bg: '#020617', accent: '#6366f1', description: 'Classic cosmic dodging', skinId: 'default' },
  { id: 'sea', name: 'Abyssal Sea', bg: '#082f49', accent: '#0ea5e9', description: 'Deep water pressure', skinId: 'cyan' },
  { id: 'forest', name: 'Mystic Forest', bg: '#052e16', accent: '#4ade80', description: 'Entangled nature', skinId: 'green' },
  { id: 'lava', name: 'Inferno Lava', bg: '#450a0a', accent: '#ef4444', description: 'Extreme heat warning', skinId: 'gold' },
  { id: 'cyber', name: 'Cyber City', bg: '#0f0720', accent: '#d946ef', description: 'Neon-infused grid', skinId: 'pink' },
];

type Projectile = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  type: 'rocket' | 'arrow' | 'shuriken' | 'plasma' | 'planet' | 'earth' | 'glitch';
  color: string;
  rotation?: number;
  homingLife?: number;
};

type Collectible = {
  id: number;
  x: number;
  y: number;
  size: number;
  life: number;
  type: 'coin' | 'shield' | 'bomb';
  pulse: number;
};

type Warning = {
  id: number;
  x: number;
  y: number;
  side: number;
  life: number;
  targetX: number;
  targetY: number;
  isEarth?: boolean;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
};

// --- Components ---

const JoystickControl = ({ onUpdate, isPortrait }: { onUpdate: (vector: { x: number, y: number }) => void, isPortrait?: boolean }) => {
  const [isActive, setIsActive] = useState(false);
  const [basePos, setBasePos] = useState({ x: 0, y: 0, relX: 0, relY: 0 });
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    
    // Store both viewport-relative (for stable dx/dy) and container-relative (for rendering)
    setBasePos({ 
      x: clientX, 
      y: clientY,
      relX: clientX - rect.left,
      relY: clientY - rect.top
    });
    setIsActive(true);
    setStickPos({ x: 0, y: 0 });
  };

  const onMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isActive) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const dx = clientX - basePos.x;
    const dy = clientY - basePos.y;
    const radius = isPortrait ? 40 : 60; // Smaller radius for smaller joystick
    const distance = Math.hypot(dx, dy);

    let finalDx = dx;
    let finalDy = dy;

    if (distance > radius) {
      finalDx = (dx / distance) * radius;
      finalDy = (dy / distance) * radius;
    }

    setStickPos({ x: finalDx, y: finalDy });
    onUpdate({ x: finalDx / radius, y: finalDy / radius });
  }, [isActive, basePos, onUpdate, isPortrait]);

  const onEnd = useCallback(() => {
    setIsActive(false);
    setStickPos({ x: 0, y: 0 });
    onUpdate({ x: 0, y: 0 });
  }, [onUpdate]);

  useEffect(() => {
    if (isActive) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onEnd);
    }
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isActive, onMove, onEnd]);

  return (
    <div 
      ref={containerRef}
      onMouseDown={onStart}
      onTouchStart={onStart}
      className="absolute inset-0 w-full h-full touch-none z-10 overflow-hidden"
    >
      {isActive && (
        <div 
          className="absolute z-20 pointer-events-none"
          style={{ 
            left: basePos.relX, 
            top: basePos.relY, 
            transform: 'translate(-50%, -50%)' 
          }}
        >
          {/* Visual Shell */}
          <div className={`rounded-full bg-slate-900/60 border-2 border-indigo-500 bg-indigo-950/20 flex items-center justify-center relative shadow-2xl scale-105 ${isPortrait ? 'w-32 h-32' : 'w-44 h-44'}`}>
            {/* Background patterns */}
            <div className="absolute inset-0 rounded-full border border-white/5 m-3" />
            <div className="absolute inset-0 rounded-full border border-white/5 m-10" />
            
            {/* Directional indicators */}
            <div className={`absolute top-3 left-1/2 -translate-x-1/2 w-1 h-2 rounded-full transition-colors ${stickPos.y < -20 ? 'bg-indigo-400' : 'bg-white/10'}`} />
            <div className={`absolute bottom-3 left-1/2 -translate-x-1/2 w-1 h-2 rounded-full transition-colors ${stickPos.y > 20 ? 'bg-indigo-400' : 'bg-white/10'}`} />
            <div className={`absolute left-3 top-1/2 -translate-y-1/2 h-1 w-2 rounded-full transition-colors ${stickPos.x < -20 ? 'bg-indigo-400' : 'bg-white/10'}`} />
            <div className={`absolute right-3 top-1/2 -translate-y-1/2 h-1 w-2 rounded-full transition-colors ${stickPos.x > 20 ? 'bg-indigo-400' : 'bg-white/10'}`} />

            <div className="absolute inset-0 rounded-full bg-indigo-500/5 blur-2xl" />
            
            <motion.div 
              animate={{ x: stickPos.x, y: stickPos.y }}
              transition={{ type: 'spring', damping: 15, stiffness: 600, mass: 0.3 }}
              className={`${isPortrait ? 'w-14 h-14' : 'w-20 h-20'} rounded-full flex items-center justify-center z-10 relative`}
            >
              {/* Glow effect */}
              <div className="absolute inset-0 rounded-full bg-indigo-500/30 scale-125 blur-md" />
              
              {/* The stick itself */}
              <div className={`${isPortrait ? 'w-12 h-12' : 'w-16 h-16'} rounded-full border-2 border-indigo-300 bg-white shadow-[0_0_20px_rgba(129,140,248,0.8)] scale-90 flex items-center justify-center`}>
                 <div className={`${isPortrait ? 'w-6 h-6' : 'w-8 h-8'} rounded-full border-2 border-indigo-100 bg-indigo-50`} />
              </div>
            </motion.div>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [gameState, setGameState] = useState<'start' | 'lobby' | 'playing' | 'gameover'>('start');
  const [isPaused, setIsPaused] = useState(false);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [leaderboard, setLeaderboard] = useState<{name: string, score: number, userId?: string, photoURL?: string}[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);
  const [bonusScore, setBonusScore] = useState(0);
  const [selectedSkin, setSelectedSkin] = useState(SKINS[0]);
  const [selectedTheme, setSelectedTheme] = useState(THEMES[0]);
  const [sensitivity, setSensitivity] = useState(0.15);
  const [playerName, setPlayerName] = useState("");
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [useJoystick, setUseJoystick] = useState(false);
  const [joystickVector, setJoystickVector] = useState({ x: 0, y: 0 });
  const [isPortrait, setIsPortrait] = useState(window.innerWidth < window.innerHeight);
  
  // Game state refs (to avoid re-renders in the loop)
  const playerPos = useRef({ x: 0, y: 0 });
  const targetPos = useRef({ x: 0, y: 0 });
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const isKeyboardMoving = useRef(false);
  const projectiles = useRef<Projectile[]>([]);
  const collectibles = useRef<Collectible[]>([]);
  const warnings = useRef<Warning[]>([]);
  const particles = useRef<Particle[]>([]);
  const bgElements = useRef<{x: number, y: number, size: number, speed: number, alpha: number}[]>([]);
  const playerTrail = useRef<{x: number, y: number}[]>([]);
  const lastSpawnTime = useRef(0);
  const lastCoinSpawnTime = useRef(0);
  const startTime = useRef(0);
  const spawnRate = useRef(INITIAL_SPAWN_RATE);
  const projectileSpeed = useRef(BASE_PROJECTILE_SPEED);
  const difficultyMilestone = useRef(2000);
  const lastShieldMilestone = useRef(0);
  const lastBombMilestone = useRef(0);
  // Milestone trackers
  const spawn6000 = useRef(false);
  const spawn7000 = useRef(false);
  const spawn9000 = useRef(false);
  const last2kMilestone = useRef(10000);

  const shieldCount = useRef(0);
  const bonusScoreRef = useRef(0);
  const scoreRef = useRef(0);
  const sensitivityRef = useRef(0.15);
  const useJoystickRef = useRef(false);
  const joystickVectorRef = useRef({ x: 0, y: 0 });
  const skinColorRef = useRef(SKINS[0].color);
  const pauseStartTime = useRef<number | null>(null);
  const frameId = useRef<number>(0);
  const dimensions = useRef({ width: 0, height: 0 });

  // Sync refs with state
  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    if (playerName && !user) {
      localStorage.setItem('void-dodger-playername', playerName);
    }
  }, [playerName, user]);

  useEffect(() => {
    useJoystickRef.current = useJoystick;
  }, [useJoystick]);

  useEffect(() => {
    joystickVectorRef.current = joystickVector;
  }, [joystickVector]);

  useEffect(() => {
    skinColorRef.current = selectedSkin.color;
  }, [selectedSkin]);

  // Initialize Firebase, Auth and Leaderboard
  useEffect(() => {
    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    // Check for touch device
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);

    const handleResize = () => {
      setIsPortrait(window.innerWidth < window.innerHeight);
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    // Auth listener
    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        setPlayerName(currentUser.displayName || generateRandomName());
        
        // Fetch user's high score from Firestore
        const userDocRef = doc(db, 'leaderboard', currentUser.uid);
        try {
          const userDoc = await getDoc(userDocRef);
          if (userDoc.exists()) {
            setHighScore(userDoc.data().score);
            // If they have a saved name in Firestore, use it? 
            // For now, let's stick to displayName or local storage as secondary
          }
        } catch (error) {
          console.error("Error fetching user high score:", error);
        }
      } else {
        const savedHL = localStorage.getItem('void-dodger-highscore');
        if (savedHL) setHighScore(parseInt(savedHL));

        const savedName = localStorage.getItem('void-dodger-playername');
        if (savedName) {
          setPlayerName(savedName);
        } else {
          setPlayerName(generateRandomName());
        }
      }
    });

    // Real-time Leaderboard listener
    setLeaderboardLoading(true);
    const q = query(collection(db, 'leaderboard'), orderBy('score', 'desc'), limit(15));
    const unsubscribeLB = onSnapshot(q, (snapshot) => {
      const scores = snapshot.docs.map(doc => ({
        name: doc.data().playerName,
        score: doc.data().score,
        userId: doc.data().userId,
        photoURL: doc.data().photoURL
      }));
      setLeaderboard(scores);
      setLeaderboardLoading(false);
    }, (error) => {
      setLeaderboardLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'leaderboard');
    });

    return () => {
      unsubscribeAuth();
      unsubscribeLB();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const updateLeaderboard = useCallback(async (finalScore: number) => {
    const nameToUse = playerName.trim() || 'Void_Walker';
    
    // Update local high score for immediate feedback
    if (finalScore > highScore) {
      setHighScore(finalScore);
      localStorage.setItem('void-dodger-highscore', finalScore.toString());
    }

    // If logged in, update Firestore
    if (user) {
      const userDocRef = doc(db, 'leaderboard', user.uid);
      try {
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists() || finalScore > userDoc.data().score) {
          await setDoc(userDocRef, {
            playerName: nameToUse,
            score: finalScore,
            userId: user.uid,
            photoURL: user.photoURL || '',
            createdAt: serverTimestamp()
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `leaderboard/${user.uid}`);
      }
    }
  }, [highScore, playerName, user]);

  // Handle Resize
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        dimensions.current = { width, height };
        if (canvasRef.current) {
          canvasRef.current.width = width;
          canvasRef.current.height = height;
          
          // Center player on first resize or if at 0,0
          if (playerPos.current.x === 0 && playerPos.current.y === 0) {
            playerPos.current = { x: width / 2, y: height / 2 };
            targetPos.current = { x: width / 2, y: height / 2 };
          }
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const spawnPlanet = useCallback((warning: Warning) => {
    const { width, height } = dimensions.current;
    let x = warning.x;
    let y = warning.y;
    
    const angle = Math.atan2(warning.targetY - y, warning.targetX - x);
    const speed = projectileSpeed.current * (warning.isEarth ? 0.4 : 1.2); // Earth is slower but homing
    
    const obstacleScale = isTouchDevice ? 0.55 : 1;
    const baseSize = warning.isEarth ? 60 : 150 + Math.random() * 80;
    const finalSize = baseSize * obstacleScale;

    projectiles.current.push({
      id: Date.now() + Math.random(),
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: finalSize,
      type: warning.isEarth ? 'earth' : 'planet',
      color: warning.isEarth ? '#3b82f6' : `hsl(${Math.random() * 360}, 70%, 60%)`,
      rotation: Math.random() * Math.PI * 2,
      homingLife: warning.isEarth ? 9999 : 0
    });
  }, [isTouchDevice]);

  const spawnCollectible = useCallback((type: 'coin' | 'shield' | 'bomb') => {
    const { width, height } = dimensions.current;
    const padding = 100;
    collectibles.current.push({
      id: Date.now() + Math.random(),
      x: padding + Math.random() * (width - padding * 2),
      y: padding + Math.random() * (height - padding * 2),
      size: type === 'coin' ? 20 : 30,
      life: type === 'coin' ? 300 : 600,
      type,
      pulse: 0
    });
  }, []);

  const spawnProjectile = useCallback(() => {
    const { width, height } = dimensions.current;
    const side = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
    let x = 0, y = 0;
    
    if (side === 0) { x = Math.random() * width; y = -150; }
    else if (side === 1) { x = width + 150; y = Math.random() * height; }
    else if (side === 2) { x = Math.random() * width; y = height + 150; }
    else { x = -150; y = Math.random() * height; }

    const rand = Math.random();
    const obstacleScale = isTouchDevice ? 0.55 : 1;
    const currentScore = scoreRef.current;
    
    // Earth spawn logic at 7000+
    if (currentScore >= 7000 && rand > 0.94) {
      const earthExists = projectiles.current.some(p => p.type === 'earth') || warnings.current.some(w => w.isEarth);
      if (!earthExists) {
        warnings.current.push({
          id: Date.now() + Math.random(),
          x, y,
          side,
          life: 90,
          targetX: playerPos.current.x,
          targetY: playerPos.current.y,
          isEarth: true
        });
        return;
      }
    }

    // Glitch spawn logic at 10000+
    if (currentScore >= 10000 && rand > 0.92) {
      projectiles.current.push({
        id: Date.now() + Math.random(),
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        size: 20 * obstacleScale,
        type: 'glitch',
        color: '#fff',
        rotation: 0
      });
      return;
    }

    // Planet spawn logic (Warning first)
    let planetChance = 0.82; // Default chance
    if (currentScore >= 3000 && currentScore < 7000) {
      planetChance = 0.95; // Lower chance for planets in mid-game
    } else if (currentScore >= 7000) {
      planetChance = 0.88; // Adjusted
    }

    if (rand > planetChance) {
      warnings.current.push({
        id: Date.now() + Math.random(),
        x, y,
        side,
        life: 80,
        targetX: playerPos.current.x,
        targetY: playerPos.current.y
      });
      return;
    }

    const angle = Math.atan2(playerPos.current.y - y, playerPos.current.x - x);
    const spread = (Math.random() - 0.5) * 0.4;
    const finalAngle = angle + spread;
    
    const difficultyMultiplier = (isPortrait && isTouchDevice) ? 0.75 : 1.0;
    const speed = projectileSpeed.current * (0.8 + Math.random() * 0.4) * difficultyMultiplier;
    
    let type: Projectile['type'] = 'arrow';
    let color = '#f59e0b';
    let size = 8 * obstacleScale;
    let homingLife = 0;

    if (rand > 0.8) {
      type = 'plasma';
      color = '#a855f7';
      size = 12 * obstacleScale;
      homingLife = 180;
    } else if (rand > 0.6) {
      type = 'shuriken';
      color = '#94a3b8';
      size = 10 * obstacleScale;
    } else if (rand > 0.35) {
      type = 'rocket';
      color = '#ef4444';
      size = 15 * obstacleScale;
    }
    
    projectiles.current.push({
      id: Date.now() + Math.random(),
      x, y,
      vx: Math.cos(finalAngle) * speed * (type === 'rocket' ? 1.5 : type === 'shuriken' ? 1.8 : 1),
      vy: Math.sin(finalAngle) * speed * (type === 'rocket' ? 1.5 : type === 'shuriken' ? 1.8 : 1),
      size,
      type,
      color,
      rotation: 0,
      homingLife
    });
  }, []);

  const createExplosion = (x: number, y: number, color: string, count = 12) => {
    for (let i = 0; i < count; i++) {
      particles.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: (Math.random() - 0.5) * 8,
        life: 1,
        color
      });
    }
  };

  const gameLoop = useCallback((time: number) => {
    if (isPaused) return;

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const { width, height } = dimensions.current;

    // --- Draw Theme Background ---
    ctx.fillStyle = selectedTheme.bg;
    ctx.fillRect(0, 0, width, height);

    // HUD depth overlays
    const topGrad = ctx.createLinearGradient(0, 0, 0, 80);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    topGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, width, 80);

    const botGrad = ctx.createLinearGradient(0, height, 0, height - 80);
    botGrad.addColorStop(0, 'rgba(0,0,0,0.3)');
    botGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = botGrad;
    ctx.fillRect(0, height - 80, width, 80);

    // Draw Theme Specific BG Details
    if (selectedTheme.id === 'cyber') {
      ctx.strokeStyle = 'rgba(217, 70, 239, 0.1)';
      ctx.lineWidth = 1;
      const gridSize = 50;
      const offset = (time / 20) % gridSize;
      for (let x = offset; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = offset; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Update and Draw Background Elements (Stars, Bubbles, etc)
    ctx.save();
    bgElements.current.forEach(el => {
      // Movement
      if (selectedTheme.id === 'lava') {
        el.y -= el.speed * 2;
        el.x += Math.sin(time / 500 + el.y / 100) * 0.5;
        if (el.y < -20) el.y = height + 20;
      } else if (selectedTheme.id === 'sea') {
        el.y -= el.speed * 1.5;
        el.x += Math.cos(time / 800 + el.y / 100) * 0.8;
        if (el.y < -20) el.y = height + 20;
      } else {
        el.y += el.speed;
        if (el.y > height) el.y = 0;
      }

      // Drawing
      ctx.globalAlpha = el.alpha;
      if (selectedTheme.id === 'sea') {
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.size * 2, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (selectedTheme.id === 'lava') {
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.size * 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#f97316';
        ctx.fill();
      } else if (selectedTheme.id === 'forest') {
        ctx.save();
        ctx.translate(el.x, el.y);
        ctx.rotate(time / 500 + el.x);
        ctx.fillStyle = '#166534';
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(el.size * 4, -el.size * 2);
        ctx.lineTo(el.size * 4, el.size * 2);
        ctx.fill();
        ctx.restore();
      } else if (selectedTheme.id === 'cyber') {
        ctx.fillStyle = '#d946ef';
        ctx.fillRect(el.x, el.y, 2, 2);
      } else {
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(el.x, el.y, el.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();

      // Update Score
      if (gameState === 'playing') {
        const elapsed = (time - startTime.current) / 1000;
        const currentScore = Math.floor(elapsed * 100) + bonusScoreRef.current;
        scoreRef.current = currentScore;
        setScore(currentScore);

      // --- Specific Milestones ---
      // No items under 6000
      if (currentScore >= 6000) {
        // Shield at 6000
        if (currentScore >= 6000 && !spawn6000.current) {
          spawn6000.current = true;
          spawnCollectible('shield');
        }
        // Shield at 7000
        if (currentScore >= 7000 && !spawn7000.current) {
          spawn7000.current = true;
          spawnCollectible('shield');
        }
        // Bomb at 9000
        if (currentScore >= 9000 && !spawn9000.current) {
          spawn9000.current = true;
          spawnCollectible('bomb');
        }
        // 10000+ Intervals (Every 2k: Shield & Bomb)
        if (currentScore >= 10000 && currentScore >= last2kMilestone.current) {
          spawnCollectible('shield');
          spawnCollectible('bomb');
          last2kMilestone.current = (Math.floor(currentScore / 2000) + 1) * 2000;
        }
      }

        // Difficulty Milestone Check
        if (currentScore >= difficultyMilestone.current) {
          const isAdvanced = currentScore >= 5000;
          const isExtreme = currentScore >= 8000;
          
          // Milestone logic
          if (difficultyMilestone.current === 4000) {
            difficultyMilestone.current = 5000;
          } else {
            difficultyMilestone.current += isAdvanced ? 1000 : 2000;
          }

          const spawnMultiplier = isExtreme ? 0.98 : (isAdvanced ? 0.95 : 0.88); 
          spawnRate.current = Math.max(MIN_SPAWN_RATE, spawnRate.current * spawnMultiplier); 
          
          const speedBoost = isExtreme ? 0.08 : (isAdvanced ? 0.12 : 0.25);
          projectileSpeed.current += speedBoost;
          
          createExplosion(width / 2, height / 2, '#ef4444', 60);
        }
      }

    // Update Player
    let moveX = 0;
    let moveY = 0;

    if (keysPressed.current['ArrowUp'] || keysPressed.current['w'] || keysPressed.current['W']) moveY -= 1;
    if (keysPressed.current['ArrowDown'] || keysPressed.current['s'] || keysPressed.current['S']) moveY += 1;
    if (keysPressed.current['ArrowLeft'] || keysPressed.current['a'] || keysPressed.current['A']) moveX -= 1;
    if (keysPressed.current['ArrowRight'] || keysPressed.current['d'] || keysPressed.current['D']) moveX += 1;

    if (moveX !== 0 || moveY !== 0) {
      isKeyboardMoving.current = true;
      // Normalize vector
      const length = Math.hypot(moveX, moveY);
      moveX /= length;
      moveY /= length;
      
      const speed = KEYBOARD_SPEED;
      playerPos.current.x = Math.max(0, Math.min(width, playerPos.current.x + moveX * speed));
      playerPos.current.y = Math.max(0, Math.min(height, playerPos.current.y + moveY * speed));
      targetPos.current.x = playerPos.current.x;
      targetPos.current.y = playerPos.current.y;
    } else if (useJoystickRef.current && (joystickVectorRef.current.x !== 0 || joystickVectorRef.current.y !== 0)) {
      const speed = KEYBOARD_SPEED * 0.4; // Reduced speed as requested
      playerPos.current.x = Math.max(0, Math.min(width, playerPos.current.x + joystickVectorRef.current.x * speed));
      playerPos.current.y = Math.max(0, Math.min(height, playerPos.current.y + joystickVectorRef.current.y * speed));
      targetPos.current.x = playerPos.current.x;
      targetPos.current.y = playerPos.current.y;
    } else {
      const dx = targetPos.current.x - playerPos.current.x;
      const dy = targetPos.current.y - playerPos.current.y;
      playerPos.current.x += dx * sensitivityRef.current;
      playerPos.current.y += dy * sensitivityRef.current;
    }

    // Update Player Trail
    playerTrail.current.unshift({ x: playerPos.current.x, y: playerPos.current.y });
    if (playerTrail.current.length > 12) playerTrail.current.pop();

    // Draw Player Trail
    ctx.save();
    playerTrail.current.forEach((pos, i) => {
      const alpha = (1 - i / playerTrail.current.length) * 0.4;
      const size = PLAYER_RADIUS * (1 - i / playerTrail.current.length);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      ctx.fillStyle = skinColorRef.current;
      ctx.globalAlpha = alpha;
      ctx.fill();
    });
    ctx.restore();

    // Draw Shield Aura
    if (shieldCount.current > 0) {
      const count = shieldCount.current;
      
      // Ring Level 3 (Max)
      if (count >= 3) {
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 20, 0, Math.PI * 2);
        ctx.strokeStyle = '#22c55e'; // Emerald/Green for Level 3
        ctx.lineWidth = 5;
        ctx.setLineDash([12, 6]);
        ctx.lineDashOffset = -time / 10;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
        ctx.fill();
      }

      // Ring Level 2
      if (count >= 2) {
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 14, 0, Math.PI * 2);
        ctx.strokeStyle = '#fbbf24'; // Gold
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 4]);
        ctx.lineDashOffset = time / 15;
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 14, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
        ctx.fill();
      }

      // Main Ring (Level 1)
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 8, 0, Math.PI * 2);
      ctx.strokeStyle = count >= 2 ? '#fff' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 5]);
      ctx.lineDashOffset = -time / 20;
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.beginPath();
      ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 8, 0, Math.PI * 2);
      ctx.fillStyle = count >= 2 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(56, 189, 248, 0.2)';
      ctx.fill();
    }

    // Draw Player
    ctx.save();
    ctx.shadowBlur = 20;
    ctx.shadowColor = skinColorRef.current;
    
    // Outer Ring
    ctx.beginPath();
    ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS + 2, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Main Body
    ctx.beginPath();
    ctx.arc(playerPos.current.x, playerPos.current.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = skinColorRef.current;
    ctx.fill();

    // Detail / Icon
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(selectedSkin.icon || '🛸', playerPos.current.x, playerPos.current.y);
    
    ctx.restore();

    // Spawn Projectiles
    if (time - lastSpawnTime.current > spawnRate.current) {
      spawnProjectile();
      // Double spawn at 10000+ (Hell Mode)
      if (scoreRef.current >= 10000) {
        spawnProjectile();
      }
      lastSpawnTime.current = time;
      spawnRate.current = Math.max(MIN_SPAWN_RATE, spawnRate.current - 2);
      projectileSpeed.current += SPEED_INCREMENT;
    }

    // Spawn Coins
    const coinInterval = scoreRef.current >= 6000 ? 2666 : 4000;
    if (time - lastCoinSpawnTime.current > coinInterval) {
      spawnCollectible('coin');
      lastCoinSpawnTime.current = time;
    }

    // Update & Draw Collectibles
    collectibles.current = collectibles.current.filter(c => {
      c.life--;
      c.pulse += 0.1;
      
      const dist = Math.hypot(c.x - playerPos.current.x, c.y - playerPos.current.y);
      if (dist < (PLAYER_RADIUS + c.size / 2) * 1.2) { // Slightly larger pickup radius for coins
        if (c.type === 'coin') {
          bonusScoreRef.current += 200;
          setBonusScore(bonusScoreRef.current);
          scoreRef.current += 200; // Update ref immediately for logic
          setScore(scoreRef.current); // Update state for UI
          createExplosion(c.x, c.y, '#fbbf24', 20);
        } else if (c.type === 'shield') {
          shieldCount.current = Math.min(3, shieldCount.current + 1);
          let blastColor = '#38bdf8';
          if (shieldCount.current === 2) blastColor = '#fbbf24';
          if (shieldCount.current === 3) blastColor = '#22c55e';
          createExplosion(c.x, c.y, blastColor, 30);
        } else if (c.type === 'bomb') {
          // Clear all projectiles and warnings
          projectiles.current.forEach(p => createExplosion(p.x, p.y, p.color, 10));
          projectiles.current = [];
          warnings.current = [];
          createExplosion(c.x, c.y, '#ef4444', 100);
          // Flash effect
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.fillRect(0, 0, width, height);
        }
        return false;
      }

      const scale = 1 + Math.sin(c.pulse) * 0.2;
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(scale, scale);
      
      ctx.beginPath();
      ctx.arc(0, 0, c.size/2, 0, Math.PI * 2);
      let color = '#fbbf24';
      if (c.type === 'shield') color = '#38bdf8';
      if (c.type === 'bomb') color = '#ef4444';
      
      ctx.fillStyle = color;
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0;
      
      ctx.fillStyle = c.type === 'bomb' ? '#fff' : (c.type === 'coin' ? '#92400e' : '#0c4a6e');
      ctx.font = `${c.type === 'coin' ? 18 : 22}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let icon = '🪙';
      if (c.type === 'shield') icon = '🛡️';
      if (c.type === 'bomb') icon = '💣';
      ctx.fillText(icon, 0, 0);
      
      ctx.restore();
      return c.life > 0;
    });

    // Update & Draw Warnings
    warnings.current = warnings.current.filter(w => {
      w.life--;
      if (w.life <= 0) {
        spawnPlanet(w);
        return false;
      }

      const padding = 60;
      const wx = Math.max(padding, Math.min(width - padding, w.x));
      const wy = Math.max(padding, Math.min(height - padding, w.y));
      
      const alpha = Math.abs(Math.sin(time / 100));
      ctx.save();
      ctx.translate(wx, wy);
      ctx.beginPath();
      ctx.arc(0, 0, w.isEarth ? 35 : 45, 0, Math.PI * 2);
      ctx.fillStyle = w.isEarth ? `rgba(59, 130, 246, ${alpha * 0.3})` : `rgba(239, 68, 68, ${alpha * 0.3})`;
      ctx.fill();
      ctx.fillStyle = w.isEarth ? `rgba(59, 130, 246, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
      ctx.font = 'bold 40px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', 0, 0);
      if (w.isEarth) {
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText('EARTH', 0, 25);
      }
      ctx.restore();
      return true;
    });

    // Update & Draw Projectiles
    projectiles.current = projectiles.current.filter(p => {
      // Homing logic for Plasma and Earth
      if ((p.type === 'plasma' || p.type === 'earth') && p.homingLife && p.homingLife > 0) {
        const angleToPlayer = Math.atan2(playerPos.current.y - p.y, playerPos.current.x - p.x);
        const currentAngle = Math.atan2(p.vy, p.vx);
        let diff = angleToPlayer - currentAngle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        
        const turnSpeed = p.type === 'earth' ? 0.015 : 0.02; // Slightly better homing for Earth
        const newAngle = currentAngle + diff * turnSpeed;
        const speed = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(newAngle) * speed;
        p.vy = Math.sin(newAngle) * speed;
        if (p.type === 'plasma') p.homingLife--;
      }

      // Glitch behavior
      if (p.type === 'glitch') {
        if (Math.random() > 0.9) {
          p.vx += (Math.random() - 0.5) * 2;
          p.vy += (Math.random() - 0.5) * 2;
          p.size = 10 + Math.random() * 30;
          p.color = `hsl(${Math.random() * 360}, 100%, 50%)`;
        }
      }

      p.x += p.vx;
      p.y += p.vy;

      const dist = Math.hypot(p.x - playerPos.current.x, p.y - playerPos.current.y);
      if (dist < (PLAYER_RADIUS + p.size / 2) * 0.85) { // Collision Padding for better feel
        if (shieldCount.current > 0) {
          shieldCount.current--;
          let blastColor = '#fff';
          if (shieldCount.current === 2) blastColor = '#22c55e';
          if (shieldCount.current === 1) blastColor = '#fbbf24';
          if (shieldCount.current === 0) blastColor = '#38bdf8';
          createExplosion(p.x, p.y, blastColor, 40);
          return false; // Destroy projectile
        } else {
          createExplosion(playerPos.current.x, playerPos.current.y, p.color, p.type === 'planet' || p.type === 'earth' ? 50 : 12);
          updateLeaderboard(scoreRef.current);
          setGameState('gameover');
          return false;
        }
      }

      ctx.save();
      ctx.translate(p.x, p.y);
      
      // Visibility Helper: Strong contrast enhancements
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
      ctx.strokeStyle = '#fff';
      const drawStroke = (size: number = p.size) => {
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      
      if (selectedTheme.id === 'sea') {
        // --- SEA THEME RENDERING ---
        ctx.shadowColor = '#38bdf8';
        if (p.type === 'rocket') { // Torpedo
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = '#f8fafc'; // White/Grey body
          ctx.fillRect(-p.size, -p.size/4, p.size, p.size/2);
          ctx.beginPath();
          ctx.rect(-p.size, -p.size/4, p.size, p.size/2);
          drawStroke();
          
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-p.size/4, -p.size/4);
          ctx.lineTo(-p.size/4, p.size/4);
          ctx.fill();
        } else if (p.type === 'arrow') { // Small Fish
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = '#fbbf24'; // Bright Yellow Fish
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size, p.size/2, 0, 0, Math.PI * 2);
          ctx.fill();
          drawStroke();
          
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.lineTo(-p.size - 5, -5);
          ctx.lineTo(-p.size - 5, 5);
          ctx.fill();
        } else if (p.type === 'shuriken') { // Starfish
          p.rotation = (p.rotation || 0) + 0.05;
          ctx.rotate(p.rotation);
          ctx.fillStyle = '#f43f5e';
          for (let i = 0; i < 5; i++) {
            ctx.rotate((Math.PI * 2) / 5);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(p.size, 0);
            ctx.lineTo(p.size/2, p.size/3);
            ctx.fill();
            drawStroke();
          }
        } else if (p.type === 'plasma') { // Bubble
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-p.size/4, -p.size/4, p.size/8, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        } else if (p.type === 'planet' || p.type === 'earth') { // Whale / Shark
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = p.type === 'earth' ? '#94a3b8' : '#3b82f6';
          // Body
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size/2, p.size/4, 0, 0, Math.PI * 2);
          ctx.fill();
          drawStroke();
          // Tail
          ctx.beginPath();
          ctx.moveTo(-p.size/2, 0);
          ctx.lineTo(-p.size/2 - 20, -15);
          ctx.lineTo(-p.size/2 - 20, 15);
          ctx.fill();
          drawStroke();
          // Eye
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(p.size/4, -p.size/8, 4, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'glitch') { // Jellyfish
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, Math.PI, 0);
          ctx.fill();
          drawStroke();
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.moveTo(-p.size/4 + i * p.size/4, 0);
            ctx.lineTo(-p.size/4 + i * p.size/4 + Math.sin(time/100 + i) * 5, p.size);
            ctx.strokeStyle = '#fff';
            ctx.stroke();
          }
        }
      } else if (selectedTheme.id === 'cyber') {
        // --- CYBER THEME RENDERING ---
        ctx.shadowBlur = 15;
        ctx.shadowColor = p.color;
        ctx.strokeStyle = '#fff';
        if (p.type === 'rocket') { // Data Packet
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size, -2, p.size, 4);
          ctx.fillRect(-p.size/2, -p.size/2, 4, p.size);
          ctx.beginPath();
          ctx.rect(-p.size, -2, p.size, 4);
          ctx.stroke();
        } else if (p.type === 'arrow') { // Cursor
          ctx.rotate(Math.atan2(p.vy, p.vx) + Math.PI/2);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-p.size/2, p.size);
          ctx.lineTo(0, p.size*0.8);
          ctx.lineTo(p.size/2, p.size);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.fill();
          drawStroke();
        } else if (p.type === 'shuriken') { // CPU Fan
          p.rotation = (p.rotation || 0) + 0.15;
          ctx.rotate(p.rotation);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size/4, -p.size/4, p.size/2, p.size/2);
        } else if (p.type === 'plasma') { // HUD Ring
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, p.size/4, 0, Math.PI / 2);
          ctx.strokeStyle = p.color;
          ctx.stroke();
        } else if (p.type === 'planet' || p.type === 'earth') { // Giant Virus
          ctx.rotate(time / 1000);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.strokeRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.strokeStyle = p.color;
          ctx.strokeRect(-p.size/4, -p.size/4, p.size/2, p.size/2);
        } else if (p.type === 'glitch') { // Error Box
          ctx.fillStyle = '#fff';
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.fillStyle = '#000';
          ctx.font = `bold ${p.size/2}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText('ERR', 0, p.size/6);
        }

      } else if (selectedTheme.id === 'forest') {
        // --- FOREST THEME ---
        ctx.shadowBlur = 8;
        ctx.shadowColor = '#4ade80';
        if (p.type === 'rocket') { // Bee
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.ellipse(0, 0, p.size/2, p.size/3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.fillRect(-2, -p.size/3, 4, p.size*0.66);
        } else if (p.type === 'arrow') { // Leaf
          ctx.rotate(Math.atan2(p.vy, p.vx) + Math.sin(time/200));
          ctx.fillStyle = '#4ade80'; // Brightened for contrast
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-p.size/2, -p.size/2, -p.size, 0);
          ctx.quadraticCurveTo(-p.size/2, p.size/2, 0, 0);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else if (p.type === 'shuriken') { // Spiky Seed
          p.rotation = (p.rotation || 0) + 0.1;
          ctx.rotate(p.rotation);
          ctx.fillStyle = '#fde047'; // More yellow/bright seed
          for (let i = 0; i < 8; i++) {
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(p.size, 0);
            ctx.lineTo(p.size/2, 2);
            ctx.fill();
          }
        } else if (p.type === 'planet' || p.type === 'earth') { // Glowing Ancient Rock
          ctx.fillStyle = p.type === 'earth' ? '#4ade80' : '#166534';
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.arc(p.size/6, p.size/6, p.size/4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
      } else if (selectedTheme.id === 'lava') {
        // --- LAVA THEME ---
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#fbbf24'; // Golden glow for lava projectiles
        if (p.type === 'rocket') { // Fireball
          ctx.rotate(Math.atan2(p.vy, p.vx));
          const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, p.size);
          grad.addColorStop(0, '#fff');
          grad.addColorStop(0.4, '#fde047'); // Bright Yellow
          grad.addColorStop(0.8, '#f97316'); // Orange
          grad.addColorStop(1, 'transparent');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
          // Core
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(0, 0, p.size/3, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'arrow') { // Ember
          ctx.rotate(Math.random() * Math.PI);
          ctx.fillStyle = '#fff'; // Bright White/Yellow Embers
          ctx.shadowColor = '#fff';
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
        } else if (p.type === 'shuriken') { // Magma Chunk
          p.rotation = (p.rotation || 0) + 0.05;
          ctx.rotate(p.rotation);
          ctx.fillStyle = '#fbbf24'; // Brightened for contrast
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const r = p.size * (0.8 + Math.random() * 0.4);
            const a = (i * Math.PI * 2) / 6;
            ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
          drawStroke();
        } else if (p.type === 'plasma') { // Solar Flare
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.fill();
        } else if (p.type === 'planet' || p.type === 'earth') { // Giant Meteor
          ctx.rotate(time / 1500);
          ctx.fillStyle = '#fbbf24'; // Bright yellow-orange core
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 4;
          ctx.stroke();
          // Craters
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          for (let i = 0; i < 4; i++) {
            ctx.beginPath();
            ctx.arc(Math.cos(i) * p.size/3, Math.sin(i) * p.size/3, p.size/6, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (p.type === 'glitch') { // Obsidian Blade
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = '#c026d3'; // Purple contrasting blade
          ctx.strokeStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(p.size, 0);
          ctx.lineTo(-p.size, -p.size/3);
          ctx.lineTo(-p.size, p.size/3);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else {
        // --- SPACE THEME & OTHERS ---
        ctx.strokeStyle = '#fff';
        if (p.type === 'rocket') {
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size, -p.size/4, p.size, p.size/2);
          ctx.beginPath();
          ctx.rect(-p.size, -p.size/4, p.size, p.size/2);
          drawStroke();
          ctx.fillStyle = '#fff';
          ctx.fillRect(-p.size/2, -p.size/4, p.size/4, p.size/2);
        } else if (p.type === 'arrow') {
          ctx.rotate(Math.atan2(p.vy, p.vx));
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(-p.size, -p.size/3);
          ctx.lineTo(-p.size, p.size/3);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.fill();
          drawStroke();
        } else if (p.type === 'shuriken') {
          p.rotation = (p.rotation || 0) + 0.2;
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          for (let i = 0; i < 4; i++) {
            ctx.rotate(Math.PI / 2);
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(p.size, 0);
            ctx.lineTo(p.size/2, p.size/2);
            ctx.closePath();
            ctx.fill();
            drawStroke();
          }
        } else if (p.type === 'plasma') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 15;
          ctx.shadowColor = '#fff';
          ctx.fill();
          drawStroke();
          ctx.beginPath();
          ctx.arc(0, 0, p.size/4, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
        } else if (p.type === 'planet' || p.type === 'earth') {
          p.rotation = (p.rotation || 0) + (p.type === 'earth' ? 0.005 : 0.01);
          ctx.rotate(p.rotation);
          ctx.beginPath();
          ctx.arc(0, 0, p.size/2, 0, Math.PI * 2);
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 30;
          ctx.shadowColor = '#fff';
          ctx.fill();
          drawStroke();
          
          // Planet texture
          ctx.fillStyle = p.type === 'earth' ? '#22c55e' : 'rgba(0,0,0,0.1)';
          for (let i = 0; i < (p.type === 'earth' ? 3 : 5); i++) {
            const cx = Math.cos(i * 1.5) * p.size/4;
            const cy = Math.sin(i * 1.5) * p.size/4;
            ctx.beginPath();
            if (p.type === 'earth') {
              ctx.ellipse(cx, cy, p.size/4, p.size/6, i, 0, Math.PI * 2);
            } else {
              ctx.arc(cx, cy, p.size/8, 0, Math.PI * 2);
            }
            ctx.fill();
          }
        } else if (p.type === 'glitch') {
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 20;
          ctx.shadowColor = '#fff';
          ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
          ctx.beginPath();
          ctx.rect(-p.size/2, -p.size/2, p.size, p.size);
          drawStroke();
          
          // Glitch lines
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.lineTo(p.size, 0);
          ctx.stroke();
        }
      }
      ctx.restore();
      return p.x > -400 && p.x < width + 400 && p.y > -400 && p.y < height + 400;
    });

    // Update & Draw Particles (Optimized)
    particles.current = particles.current.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      
      ctx.globalAlpha = p.life;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 1, p.y - 1, 3, 3);
      
      return p.life > 0;
    });
    ctx.globalAlpha = 1;

    if (gameState === 'playing') {
      frameId.current = requestAnimationFrame(gameLoop);
    }
  }, [gameState, spawnProjectile]);

  useEffect(() => {
    if (gameState === 'playing' && !isPaused) {
      frameId.current = requestAnimationFrame(gameLoop);
    } else {
      cancelAnimationFrame(frameId.current);
    }
    return () => cancelAnimationFrame(frameId.current);
  }, [gameState, isPaused, gameLoop]);

  const togglePause = useCallback(() => {
    if (gameState !== 'playing') return;
    
    setIsPaused(prev => {
      const next = !prev;
      if (next) {
        pauseStartTime.current = performance.now();
      } else if (pauseStartTime.current !== null) {
        const pauseDuration = performance.now() - pauseStartTime.current;
        startTime.current += pauseDuration;
        lastSpawnTime.current += pauseDuration;
        lastCoinSpawnTime.current += pauseDuration;
        pauseStartTime.current = null;
      }
      return next;
    });
  }, [gameState]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        togglePause();
      }
      keysPressed.current[e.key] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current[e.key] = false;
      
      // Reset keyboard moving state if no movement keys are pressed
      const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];
      const stillMoving = movementKeys.some(key => keysPressed.current[key]);
      if (!stillMoving) {
        isKeyboardMoving.current = false;
        // Keep targetPos at playerPos when finishing keyboard movement so mouse can take over smoothly
        targetPos.current = { x: playerPos.current.x, y: playerPos.current.y };
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [togglePause]);

  const startGame = () => {
    projectiles.current = [];
    collectibles.current = [];
    warnings.current = [];
    particles.current = [];
    spawnRate.current = INITIAL_SPAWN_RATE;
    projectileSpeed.current = BASE_PROJECTILE_SPEED;
    difficultyMilestone.current = 2000;
    lastShieldMilestone.current = 0;
    lastBombMilestone.current = 0;
    spawn6000.current = false;
    spawn7000.current = false;
    spawn9000.current = false;
    last2kMilestone.current = 10000;
    shieldCount.current = 0;
    bonusScoreRef.current = 0;
    scoreRef.current = 0;
    setScore(0);
    setBonusScore(0);
    setIsPaused(false);
    startTime.current = performance.now();
    lastSpawnTime.current = performance.now();
    lastCoinSpawnTime.current = performance.now();
    const { width, height } = dimensions.current;
    
    // Initialize Theme Background Elements
    const elements = [];
    const count = selectedTheme.id === 'cyber' ? 40 : 100;
    for (let i = 0; i < count; i++) {
      elements.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2 + 1,
        speed: Math.random() * 0.5 + 0.1,
        alpha: Math.random() * 0.5 + 0.2
      });
    }
    bgElements.current = elements;
    playerTrail.current = [];

    setGameState('playing');
  };

  useEffect(() => {
    if (gameState === 'gameover' && score > highScore) {
      setHighScore(score);
      localStorage.setItem('void-dodger-highscore', score.toString());
    }
  }, [gameState, score, highScore]);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing' || isPaused || isKeyboardMoving.current || useJoystickRef.current) return;
    
    // Prevent default scrolling behavior ONLY when playing the game
    if (e.cancelable) {
      e.preventDefault();
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    targetPos.current = {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  };

  return (
    <div 
      id="game-root"
      className={`relative w-full h-screen bg-slate-950 overflow-hidden font-sans text-white flex ${gameState === 'playing' ? 'select-none touch-none' : ''} ${
        useJoystick && gameState === 'playing' && !isPortrait ? 'flex-row' : 'flex-col'
      }`}
      onMouseMove={handleMouseMove}
      onTouchMove={gameState === 'playing' ? handleMouseMove : undefined}
      onTouchStart={gameState === 'playing' ? handleMouseMove : undefined}
    >
      {/* Game Area Wrapper - Full screen on portrait overlay, side-by-side on landscape */}
      <div 
        className={`relative transition-all duration-500 overflow-hidden ${
          useJoystick && gameState === 'playing' ? (
            isPortrait ? 'h-screen w-full' : 'h-full w-[75vw]'
          ) : 'h-screen w-full'
        }`}
        ref={containerRef}
      >
        {/* HUD */}
        <div className="absolute top-4 sm:top-8 left-4 sm:left-8 z-10 pointer-events-none">
        <div className="flex flex-col gap-0 sm:gap-1">
          <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-indigo-400 font-semibold">Score</span>
          <span className="text-2xl sm:text-4xl font-black tabular-nums text-white drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]">{score}</span>
        </div>
      </div>

      <div className="absolute top-4 sm:top-8 right-4 sm:right-8 z-10 pointer-events-none text-right">
        <div className="flex flex-col gap-0 sm:gap-1">
          <span className="text-[10px] sm:text-xs uppercase tracking-[0.2em] text-amber-400 font-semibold">High Score</span>
          <div className="flex items-center justify-end gap-1 sm:gap-2">
            <Trophy className="w-3 h-3 sm:w-4 sm:h-4 text-amber-400" />
            <span className="text-xl sm:text-2xl font-bold tabular-nums">{highScore}</span>
          </div>
        </div>
      </div>

        <canvas 
          ref={canvasRef}
          className={`w-full h-full ${useJoystick ? 'cursor-default' : 'cursor-none'}`}
        />
      </div>

      {/* Joystick Section (Mobile Only Bottom Area) */}
      {useJoystick && gameState === 'playing' && (
        <div className={`relative overflow-hidden ${
          isPortrait 
            ? 'absolute bottom-0 h-[15vh] w-full bg-black/20 border-t border-white/5 backdrop-blur-[2px]' 
            : 'h-full w-[25vw] border-l border-white/10 bg-black/40'
        }`}>
          {/* Background decoration */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ 
            backgroundImage: `radial-gradient(circle at center, ${selectedTheme.accent} 0%, transparent 70%)` 
          }} />
          <div className="absolute inset-0 opacity-5 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
          
          {/* Tech Ornaments */}
          <div className="absolute top-4 left-4 w-10 h-10 border-t border-l border-white/10 rounded-tl-lg pointer-events-none" />
          <div className="absolute top-4 right-4 w-10 h-10 border-t border-r border-white/10 rounded-tr-lg pointer-events-none" />
          <div className="absolute bottom-4 left-4 w-10 h-10 border-b border-l border-white/10 rounded-bl-lg pointer-events-none" />
          <div className="absolute bottom-4 right-4 w-10 h-10 border-b border-r border-white/10 rounded-br-lg pointer-events-none" />
          
          <JoystickControl onUpdate={(v) => setJoystickVector(v)} isPortrait={isPortrait} />
          
          {!isPortrait && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[8px] uppercase tracking-[0.5em] text-slate-600 font-bold pointer-events-none">
              Tactical Controller Interface
            </div>
          )}
        </div>
      )}

      {/* Overlays */}
      <AnimatePresence>
        {isPaused && gameState === 'playing' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            <div className="max-w-md w-full p-8 text-center">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <h2 className="text-5xl font-black mb-8 tracking-tighter uppercase italic text-indigo-400">Paused</h2>
                <div className="flex flex-col gap-4">
                  <button 
                    onClick={togglePause}
                    className="group relative px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full"
                  >
                    <Play className="w-5 h-5 fill-current" />
                    RESUME
                  </button>
                  <button 
                    onClick={startGame}
                    className="group relative px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full"
                  >
                    <RotateCcw className="w-5 h-5" />
                    RESTART
                  </button>
                  <button 
                    onClick={() => setGameState('start')}
                    className="group relative px-8 py-4 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full"
                  >
                    QUIT
                  </button>
                </div>
                <p className="mt-8 text-slate-500 text-sm uppercase tracking-widest">Press ESC to Resume</p>
              </motion.div>
            </div>
          </motion.div>
        )}

        {gameState === 'start' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm overflow-y-auto py-10 px-4 flex justify-center items-start sm:items-center"
          >
            <div className="max-w-md w-full text-center relative py-4">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                {/* Auth Section - Moved to Top */}
                <div className="mb-8 p-1 bg-white/5 rounded-2xl flex items-center justify-between">
                  {user ? (
                    <div className="flex items-center gap-3 pl-4 pr-2 py-2 w-full text-left">
                      <div className="flex-1">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Pilot Authenticated</p>
                        <p className="text-sm font-bold text-indigo-400 truncate max-w-[150px]">{user.displayName}</p>
                      </div>
                      <button 
                        onClick={() => logout()}
                        className="p-2 hover:bg-white/10 rounded-xl transition-colors text-slate-400 hover:text-red-400"
                        title="Logout"
                      >
                        <LogOut className="w-5 h-5" />
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => loginWithGoogle()}
                      disabled={isAuthLoading}
                      className="flex items-center justify-center gap-3 px-6 py-4 w-full bg-white/10 hover:bg-white/20 rounded-xl transition-all font-bold text-sm"
                    >
                      {isAuthLoading ? (
                        <RefreshCw className="w-4 h-4 animate-spin text-slate-400" />
                      ) : (
                        <>
                          <LogIn className="w-4 h-4" />
                          LOGIN WITH GOOGLE
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="inline-flex p-4 rounded-2xl bg-indigo-500/20 mb-6 relative">
                  <Target className="w-12 h-12 text-indigo-400" />
                  {user?.photoURL && (
                    <motion.img 
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      src={user.photoURL} 
                      className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full border-2 border-[#020617] shadow-lg"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
                <h1 className="text-5xl font-black mb-4 tracking-tighter uppercase italic">Void Dodger</h1>
                
                <p className="text-slate-400 mb-8 leading-relaxed text-sm">
                  {isTouchDevice ? (
                    "화면을 터치하거나 드래그하여 장애물을 피하세요."
                  ) : (
                    "마우스나 키보드(WASD/방향키)로 캐릭터를 움직여 장애물을 피하세요."
                  )}
                  <br />
                  코인을 먹으면 <span className="text-amber-400 font-bold">200점</span>, 
                  <span className="text-indigo-400 font-bold">6,000점부터 쉴드(🛡️)</span>와 
                  <span className="text-red-400 font-bold">9,000점부터 폭탄(💣)</span>이 보급됩니다!
                </p>

                <div className="mb-8">
                  <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-3 text-left">Your Pilot Name</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input 
                        type="text" 
                        value={playerName}
                        onChange={(e) => setPlayerName(e.target.value)}
                        placeholder="Enter your name..."
                        className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white font-bold focus:outline-none focus:border-indigo-500 transition-colors"
                        maxLength={15}
                      />
                    </div>
                    <button 
                      onClick={() => setPlayerName(generateRandomName())}
                      className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-colors"
                      title="Randomize Name"
                    >
                      <RefreshCw className="w-5 h-5 text-slate-400" />
                    </button>
                  </div>
                </div>

                <button 
                  onClick={() => setGameState('lobby')}
                  className="group relative px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full mb-8"
                >
                  <Play className="w-5 h-5 fill-current" />
                  GAME START
                  <div className="absolute -inset-1 bg-indigo-500/20 blur-xl group-hover:bg-indigo-500/40 transition-all rounded-xl -z-10" />
                </button>

                {/* Hall of Fame Section */}
                <div className="bg-black/40 rounded-2xl p-6 border border-white/5 relative overflow-hidden group min-h-[400px] flex flex-col">
                  <div className="absolute top-0 right-0 p-3">
                     <span className="flex items-center gap-1.5 text-[8px] font-bold text-emerald-400 uppercase tracking-tighter bg-emerald-400/10 px-2 py-0.5 rounded-full border border-emerald-400/20">
                       <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                       Live Database
                     </span>
                  </div>
                  <h3 className="text-xs uppercase tracking-widest text-slate-500 font-bold mb-6 flex items-center justify-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-400" />
                    Global Hall of Fame
                  </h3>
                  
                  {leaderboardLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
                      <RefreshCw className="w-8 h-8 animate-spin opacity-20" />
                      <p className="text-[10px] font-bold uppercase tracking-widest">Accessing Neural Records...</p>
                    </div>
                  ) : leaderboard.length > 0 ? (
                    <div className="space-y-2 flex-1 overflow-y-auto pr-1">
                      {leaderboard.map((entry, i) => (
                        <motion.div 
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.05 }}
                          key={i} 
                          className={`flex justify-between items-center text-sm p-3 rounded-xl transition-all ${
                            entry.userId === user?.uid 
                              ? 'bg-indigo-500/20 border border-indigo-500/30' 
                              : 'bg-white/5 hover:bg-white/10 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col items-center justify-center w-6">
                              <span className={`text-[10px] font-black ${i === 0 ? 'text-amber-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-700' : 'text-slate-600'}`}>{i+1}</span>
                              {i < 3 && <div className={`w-1 h-1 rounded-full mt-0.5 ${i === 0 ? 'bg-amber-400' : i === 1 ? 'bg-slate-300' : 'bg-amber-700'}`} />}
                            </div>
                            {entry.photoURL ? (
                              <img src={entry.photoURL} className="w-8 h-8 rounded-full border-2 border-white/10" referrerPolicy="no-referrer" alt="" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center border-2 border-white/10 text-[10px] font-bold text-slate-500">
                                {entry.name.charAt(0)}
                              </div>
                            )}
                            <div className="flex flex-col">
                              <span className={`font-bold leading-none truncate max-w-[120px] ${entry.userId === user?.uid ? 'text-indigo-400' : 'text-slate-200'}`}>
                                {entry.name}
                              </span>
                              {entry.userId === user?.uid && <span className="text-[8px] uppercase tracking-widest text-indigo-500 font-black mt-1">You</span>}
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <span className="font-mono text-amber-400 font-black tracking-tight text-base">{entry.score.toLocaleString()}</span>
                            <span className="text-[8px] uppercase text-slate-600 font-bold">PTS</span>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-500">
                      <Target className="w-12 h-12 opacity-10" />
                      <p className="text-xs font-bold uppercase tracking-widest">The archives are empty.</p>
                      <p className="text-[10px] opacity-40 text-center">Be the first player to dominate the leaderboards!</p>
                    </div>
                  )}

                  <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                    <span>Top 15 Agents</span>
                    <span>Real-time Sync</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        )}

        {gameState === 'lobby' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-black/80 backdrop-blur-md overflow-y-auto py-10 px-4 flex justify-center items-start sm:items-center"
          >
            <div className="max-w-2xl w-full relative py-4">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-slate-900/50 border border-white/10 rounded-3xl p-8 shadow-2xl"
              >
                <h2 className="text-3xl font-black mb-8 text-center uppercase italic tracking-tight">Character Setup</h2>
                
                <div className="grid grid-cols-1 gap-12 mb-12">
                  {/* Unified Theme & Skin Selection */}
                  <div className="col-span-1">
                    <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">Select Theme & Skin</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      {THEMES.map((theme) => {
                        const associatedSkin = SKINS.find(s => s.id === theme.skinId) || SKINS[0];
                        return (
                          <button
                            key={theme.id}
                            onClick={() => {
                              setSelectedTheme(theme);
                              setSelectedSkin(associatedSkin);
                            }}
                            className={`group relative p-4 rounded-2xl transition-all border-2 text-left overflow-hidden ${
                              selectedTheme.id === theme.id ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/20'
                            }`}
                          >
                            <div 
                              className="absolute inset-0 opacity-10 group-hover:opacity-20 transition-opacity" 
                              style={{ background: `radial-gradient(circle at center, ${theme.accent}, transparent)` }}
                            />
                            
                            <div className="flex items-center justify-between mb-2">
                              <h4 className={`font-black uppercase italic tracking-tight text-sm ${selectedTheme.id === theme.id ? 'text-indigo-400' : 'text-white'}`}>
                                {theme.name}
                              </h4>
                              <div 
                                className="w-4 h-4 rounded-full border border-white/20 shadow-sm" 
                                style={{ backgroundColor: associatedSkin.color }}
                              />
                            </div>
                            
                            <p className="text-[10px] text-slate-500 font-bold leading-tight uppercase tracking-widest">{theme.description}</p>
                            
                            {selectedTheme.id === theme.id && (
                              <motion.div 
                                layoutId="activeTheme"
                                className="absolute top-2 right-2 w-1.5 h-1.5 bg-indigo-500 rounded-full"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
                  {/* Sensitivity Adjustment */}
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-4 italic">Controls</label>
                    <div className="flex items-center gap-4 bg-black/40 p-4 rounded-2xl border border-white/5">
                      <button 
                        onClick={() => setSensitivity(s => Math.max(0.05, s - 0.05))}
                        className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center text-xl font-bold"
                      >
                        -
                      </button>
                      <div className="flex-1 text-center">
                        <span className="text-2xl font-black tabular-nums">{(sensitivity * 100).toFixed(0)}%</span>
                        <p className="text-[8px] uppercase tracking-widest text-slate-500 font-bold mt-1">Sensitivity</p>
                      </div>
                      <button 
                        onClick={() => setSensitivity(s => Math.min(0.5, s + 0.05))}
                        className="w-10 h-10 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center text-xl font-bold"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Controller Mode Selection */}
                  {isTouchDevice && (
                    <div className="col-span-1 md:col-span-2">
                       <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-4 italic">Interface Selection</label>
                       <div className="grid grid-cols-2 gap-4">
                         <button 
                          onClick={() => setUseJoystick(false)}
                          className={`p-5 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 relative overflow-hidden ${!useJoystick ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                         >
                           <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${!useJoystick ? 'bg-indigo-500' : 'bg-transparent'}`} />
                           <Shield className="w-8 h-8 text-indigo-400" />
                           <div className="text-center">
                             <p className="text-sm font-black uppercase tracking-tight">Pointer</p>
                             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Natural Drag</p>
                           </div>
                         </button>
                         <button 
                          onClick={() => setUseJoystick(true)}
                          className={`p-5 rounded-2xl border-2 transition-all flex flex-col items-center gap-3 relative overflow-hidden ${useJoystick ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/5 bg-white/5 hover:bg-white/10'}`}
                         >
                           <div className="absolute top-0 left-0 bg-indigo-500 text-[8px] px-2 py-0.5 font-bold uppercase tracking-widest text-white rounded-br-lg">추천</div>
                           <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${useJoystick ? 'bg-indigo-500' : 'bg-transparent'}`} />
                           <Zap className="w-8 h-8 text-indigo-400" />
                           <div className="text-center">
                             <p className="text-sm font-black uppercase tracking-tight">Joystick</p>
                             <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Fixed Stick</p>
                           </div>
                         </button>
                       </div>
                    </div>
                  )}

                  {/* Leaderboard Section */}
                  <div>
                    <label className="block text-xs uppercase tracking-widest text-slate-500 font-bold mb-4">Real-time Ranking</label>
                    <div className="bg-black/40 rounded-2xl p-4 border border-white/5 max-h-[180px] overflow-y-auto custom-scrollbar">
                      {leaderboard.length > 0 ? (
                        <div className="space-y-3">
                          {leaderboard.map((entry, i) => (
                            <div key={i} className={`flex justify-between items-center text-sm ${entry.userId === user?.uid ? 'text-indigo-400' : ''}`}>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] text-slate-600 font-bold w-3">{i+1}</span>
                                {entry.photoURL && <img src={entry.photoURL} className="w-5 h-5 rounded-full border border-white/10" referrerPolicy="no-referrer" alt="" />}
                                <span className="font-bold truncate max-w-[100px]">{entry.name}</span>
                              </div>
                              <span className="font-mono text-amber-500 font-bold">{entry.score.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-center text-slate-600 text-sm py-4 italic">Connecting to relay...</p>
                      )}
                    </div>
                  </div>
                </div>

                {/* Real Start Button */}
                <button 
                  onClick={startGame}
                  className="group relative px-8 py-5 bg-white text-black font-black rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full text-xl"
                >
                  <Play className="w-6 h-6 fill-current" />
                  READY TO PLAY
                  <div className="absolute -inset-1 bg-white/20 blur-xl group-hover:bg-white/40 transition-all rounded-2xl -z-10" />
                </button>

                <button 
                  onClick={() => setGameState('start')}
                  className="mt-4 w-full py-2 text-slate-500 hover:text-white transition-colors text-sm font-bold uppercase tracking-widest"
                >
                  Back to Menu
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}

        {gameState === 'gameover' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 bg-red-950/40 backdrop-blur-md overflow-y-auto py-10 px-4 flex justify-center items-start sm:items-center"
          >
            <div className="max-w-md w-full text-center relative py-4">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
              >
                <h2 className="text-6xl font-black mb-2 text-red-500 tracking-tighter uppercase italic">Game Over</h2>
                <div className="bg-black/40 rounded-2xl p-6 mb-8 border border-white/10">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-slate-400 uppercase tracking-widest text-xs">Final Score</span>
                    <span className="text-3xl font-bold">{score}</span>
                  </div>
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-slate-400 uppercase tracking-widest text-xs">Best</span>
                    <span className="text-xl font-bold text-amber-400">{highScore}</span>
                  </div>
                  
                  {/* Mini Leaderboard in Game Over */}
                  <div className="pt-4 border-t border-white/5">
                    <h3 className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-3 text-left">Top Pilots</h3>
                    <div className="space-y-2">
                      {leaderboard.slice(0, 3).map((entry, i) => (
                        <div key={i} className="flex justify-between items-center text-xs">
                          <div className="flex items-center gap-2">
                            {entry.photoURL && <img src={entry.photoURL} className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" alt="" />}
                            <span className={`${entry.userId === user?.uid ? 'text-indigo-400 font-bold' : 'text-slate-400'}`}>
                              {i+1}. {entry.name} {entry.userId === user?.uid && '(YOU)'}
                            </span>
                          </div>
                          <span className="font-mono font-bold text-amber-400/80">{entry.score.toLocaleString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={startGame}
                  className="group relative px-8 py-4 bg-white text-black font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3 w-full"
                >
                  <RotateCcw className="w-5 h-5" />
                  TRY AGAIN
                  <div className="absolute -inset-1 bg-white/20 blur-xl group-hover:bg-white/40 transition-all rounded-xl -z-10" />
                </button>
                <button 
                  onClick={() => setGameState('lobby')}
                  className="mt-4 w-full py-3 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-3"
                >
                  BACK TO LOBBY
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Decorative Background Elements */}
      <div className="absolute inset-0 pointer-events-none opacity-20">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full blur-[120px]" style={{ backgroundColor: selectedTheme.accent }} />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-[160px]" style={{ backgroundColor: selectedTheme.accent }} />
      </div>
    </div>
  );
}
