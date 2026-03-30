import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
} from "recharts";
import {
  ShieldCheck, Zap, Eye, AlertTriangle, Upload, Lock,
  ArrowRight, LogOut, Truck, CheckSquare, Square,
  Download, MapPin, MousePointer2, Ruler, Hexagon,
  Check, Trash2, ChevronRight, BarChart3,
  Play, X, FileText, Filter, Search,
} from "lucide-react";
import EmailGateModal from "../LoginSignup/LoginSignup";
import "./LandingPage.css";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
const MAX_VIDEO_SECONDS = 10;

// ─── EHS METRICS ──────────────────────────────────────────────────────────────
const METRICS = [
  { id:"near_miss",           label:"Near-Miss Events",                 shortLabel:"Near-Miss",      icon:AlertTriangle, color:"#ef4444", isPrimary:true,  logic:"Worker–vehicle distance < safety threshold while forklift is active" },
  { id:"pedestrian_exposure", label:"Pedestrian Exposure to Forklifts", shortLabel:"Ped. Exposure",  icon:Truck,         color:"#f59e0b", isPrimary:false, logic:"Frames where any worker bounding-box is within proximity of an active forklift" },
  { id:"zone_violation",      label:"Restricted Zone Violations",       shortLabel:"Zone Violations",icon:MapPin,        color:"#a855f7", isPrimary:false, logic:"Worker detected inside a defined exclusion-zone polygon per frame" },
  { id:"ppe_compliance",      label:"PPE Compliance Rate",              shortLabel:"PPE Compliance", icon:ShieldCheck,   color:"#22c55e", isPrimary:false, logic:"Compliant worker detections ÷ total worker detections × 100" },
];
const BASE_LABELS = ["helmet","person","forklift","head"];
const PROX_PX = 120;

const SEV_COLORS = { High:"#ef4444", Medium:"#f59e0b", Low:"#22c55e" };
const SEV_BG     = { High:"rgba(239,68,68,0.1)", Medium:"rgba(245,158,11,0.1)", Low:"rgba(34,197,94,0.1)" };

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const bc = ([x,y,w,h]) => ({ cx:x+w/2, cy:y+h/2 });
const ed = (a,b) => Math.sqrt((a.cx-b.cx)**2+(a.cy-b.cy)**2);

// ─── cluster consecutive flagged frames (within GAP_FRAMES) → 1 incident ──────
function clusterFrames(flaggedIndices, gapFrames) {
  if (!flaggedIndices.length) return 0;
  let incidents = 1;
  for (let i = 1; i < flaggedIndices.length; i++) {
    if (flaggedIndices[i] - flaggedIndices[i-1] > gapFrames) incidents++;
  }
  return incidents;
}

// ─── count unique workers (by stable label+position bucket across frames) ─────
// Simple proxy: count the max number of distinct workers seen in any single frame.
// This avoids counting the same person N times across N frames.
function uniqueWorkerCount(frames) {
  return frames.reduce((max, fr) => {
    const w = fr.detections.filter(d => /person/i.test(d.label)).length;
    return Math.max(max, w);
  }, 0);
}

function computeMetrics(frames, analytics) {
  const total    = frames.length || 1;
  const FPS      = 5;                          // backend extraction fps
  const GAP      = FPS * 2;                    // 2s gap = new incident
  const duration = total / FPS;                // video duration in seconds

  // ── Per-frame flags ───────────────────────────────────────────────────────
  const nmFrames  = []; // indices of near-miss frames
  const expFrames = []; // indices of exposure frames
  const zvFrames  = []; // indices of zone-violation frames

  // PPE: track per-frame whether each visible worker has a helmet
  let workersWithHelmet = 0;
  let workersTotal      = 0;

  frames.forEach((fr, idx) => {
    const fl = fr.detections.filter(d => /forklift/i.test(d.label));
    const w  = fr.detections.filter(d => /person/i.test(d.label));
    const h  = fr.detections.filter(d => /helmet/i.test(d.label));

    // PPE — count per frame, then average at the end (per-frame coverage)
    if (w.length > 0) {
      workersTotal      += w.length;
      workersWithHelmet += Math.min(w.length, h.length);
    }

    // Zone violations
    if (fr.detections.some(d => d.inZone)) zvFrames.push(idx);

    if (!fl.length || !w.length) return;

    let nm = false, ex = false;
    w.forEach(pw => fl.forEach(pf => {
      const dist = ed(bc(pw.box), bc(pf.box));
      if (dist < PROX_PX)       { nm = true; ex = true; }
      else if (dist < PROX_PX * 2.5) { ex = true; }
    }));
    if (nm) nmFrames.push(idx);
    if (ex) expFrames.push(idx);
  });

  // ── Convert frame counts → incidents ─────────────────────────────────────
  const nmIncidents  = clusterFrames(nmFrames,  GAP);
  const expIncidents = clusterFrames(expFrames, GAP);
  const zvIncidents  = clusterFrames(zvFrames,  GAP);

  // ── Rates (incidents per minute) ─────────────────────────────────────────
  const mins         = Math.max(duration / 60, 1/60);
  const nmRate       = +(nmIncidents  / mins).toFixed(1);
  const expRate      = +(expIncidents / mins).toFixed(1);
  const zvRate       = +(zvIncidents  / mins).toFixed(1);

  // ── Average incident duration (seconds) ──────────────────────────────────
  const avgDuration = (flaggedIndices) => {
    if (!flaggedIndices.length) return 0;
    // group into runs
    const runs = []; let start = flaggedIndices[0], prev = flaggedIndices[0];
    for (let i = 1; i <= flaggedIndices.length; i++) {
      if (i === flaggedIndices.length || flaggedIndices[i] - prev > GAP) {
        runs.push((prev - start + 1) / FPS);
        if (i < flaggedIndices.length) { start = flaggedIndices[i]; }
      }
      if (i < flaggedIndices.length) prev = flaggedIndices[i];
    }
    return +(runs.reduce((a,b) => a+b, 0) / runs.length).toFixed(1);
  };

  const nmAvgDur  = avgDuration(nmFrames);
  const expAvgDur = avgDuration(expFrames);
  const zvAvgDur  = avgDuration(zvFrames);

  // ── PPE — unique-worker-based compliance ─────────────────────────────────
  // Use max simultaneous workers as proxy for unique workers in the clip
  const uniqueWorkers = uniqueWorkerCount(frames);
  // PPE non-compliant = frames where any worker lacks a helmet, clustered
  const ppeViolFrames = [];
  frames.forEach((fr, idx) => {
    const w = fr.detections.filter(d => /person/i.test(d.label));
    const h = fr.detections.filter(d => /helmet/i.test(d.label));
    if (w.length > 0 && h.length < w.length) ppeViolFrames.push(idx);
  });
  const ppeViolIncidents = clusterFrames(ppeViolFrames, GAP);

  // Compliance % = proportion of time workers were properly equipped
  const ppeCompliance = analytics?.ppe_compliance ??
    (workersTotal > 0 ? Math.round((workersWithHelmet / workersTotal) * 100) : null);

  // ── Trend data (unchanged — charts still use frame-level data) ───────────
  const sampleEvery = Math.max(1, Math.floor(frames.length / 12));
  const trendData = frames.filter((_, i) => i % sampleEvery === 0).map(fr => {
    const fl = fr.detections.filter(d => /forklift/i.test(d.label));
    const w  = fr.detections.filter(d => /person/i.test(d.label));
    const h  = fr.detections.filter(d => /helmet/i.test(d.label));
    let nm = 0;
    w.forEach(pw => fl.forEach(pf => { if (ed(bc(pw.box), bc(pf.box)) < PROX_PX) nm = 1; }));
    return {
      ts: fr.timestamp,
      "Near-Miss":      nm,
      "Ped. Exposure":  fl.length && w.length ? w.length : 0,
      "Zone Violations":fr.detections.filter(d => d.inZone).length,
      "PPE Compliance": w.length ? Math.round((Math.min(w.length, h.length) / w.length) * 100) : 0,
    };
  });

  return {
    // Incident counts (clusters of consecutive flagged frames)
    nearMiss:  nmIncidents,
    exposure:  expIncidents,
    zv:        zvIncidents,
    // Rates per minute
    nmRate, expRate, zvRate,
    // Average duration per incident (seconds)
    nmAvgDur, expAvgDur, zvAvgDur,
    // PPE
    ppe:            ppeCompliance,
    ppeViolations:  ppeViolIncidents,
    uniqueWorkers,
    // Meta
    total,
    duration: +duration.toFixed(1),
    trendData,
  };
}

// ─── BUILD EVENT LIST from AI frame data ──────────────────────────────────────
function buildEventList(frames) {
  const events=[]; const seen=new Set();
  frames.forEach((fr,idx)=>{
    const forklifts = fr.detections.filter(d=>/forklift/i.test(d.label));
    const workers   = fr.detections.filter(d=>/person/i.test(d.label));
    const helmets   = fr.detections.filter(d=>/helmet/i.test(d.label));
    const inZone    = fr.detections.filter(d=>d.inZone);
    const ts        = fr.timestamp || `Frame ${fr.frameIndex ?? idx}`;
    const ppeOk     = helmets.length >= workers.length && workers.length > 0;

    // Near-Miss
    workers.forEach(w=>{
      forklifts.forEach(fl=>{
        if(ed(bc(w.box),bc(fl.box))<PROX_PX){
          const key=`NM-${idx}`;
          if(!seen.has(key)){ seen.add(key);
            events.push({ id:`EVT-${String(events.length+1).padStart(3,"0")}`,
              timestamp:ts, eventType:"Near-Miss Event", severity:"High",
              ppeStatus:ppeOk?"Compliant":"Non-Compliant",
              exposure:`${((fr.frameIndex??idx)/24).toFixed(1)}s`,
              camera:"Uploaded Feed", zone:"Proximity Zone",
              confidence:Math.round((w.confidence||0.91)*100),
              personsDetected:workers.length, vehicleDetected:"Forklift",
              frameIndex:fr.frameIndex??idx, detections:fr.detections });
          }
        }
      });
    });

    // Zone Violation
    if(inZone.length>0){
      const key=`ZV-${idx}`;
      if(!seen.has(key)){ seen.add(key);
        events.push({ id:`EVT-${String(events.length+1).padStart(3,"0")}`,
          timestamp:ts, eventType:"Zone Violation", severity:"Medium",
          ppeStatus:ppeOk?"Compliant":"Non-Compliant",
          exposure:`${((fr.frameIndex??idx)/24).toFixed(1)}s`,
          camera:"Uploaded Feed", zone:inZone[0]?.zone||"Exclusion Zone",
          confidence:Math.round((inZone[0]?.confidence||0.87)*100),
          personsDetected:workers.length, vehicleDetected:forklifts.length>0?"Forklift":"None",
          frameIndex:fr.frameIndex??idx, detections:fr.detections });
      }
    }

    // PPE Violation
    if(workers.length>0 && helmets.length<workers.length){
      const key=`PPE-${idx}`;
      if(!seen.has(key)){ seen.add(key);
        events.push({ id:`EVT-${String(events.length+1).padStart(3,"0")}`,
          timestamp:ts, eventType:"PPE Violation",
          severity:helmets.length===0?"High":"Medium",
          ppeStatus:"Non-Compliant",
          exposure:`${((fr.frameIndex??idx)/24).toFixed(1)}s`,
          camera:"Uploaded Feed", zone:"General Area",
          confidence:Math.round(((fr.detections[0]?.confidence)||0.85)*100),
          personsDetected:workers.length, vehicleDetected:forklifts.length>0?"Forklift":"None",
          frameIndex:fr.frameIndex??idx, detections:fr.detections });
      }
    }

    // Pedestrian Exposure
    workers.forEach(w=>{
      forklifts.forEach(fl=>{
        if(ed(bc(w.box),bc(fl.box))<PROX_PX*2.5 && ed(bc(w.box),bc(fl.box))>=PROX_PX){
          const key=`PE-${idx}`;
          if(!seen.has(key)){ seen.add(key);
            events.push({ id:`EVT-${String(events.length+1).padStart(3,"0")}`,
              timestamp:ts, eventType:"Pedestrian Exposure", severity:"Low",
              ppeStatus:ppeOk?"Compliant":"Non-Compliant",
              exposure:`${((fr.frameIndex??idx)/24).toFixed(1)}s`,
              camera:"Uploaded Feed", zone:"Forklift Corridor",
              confidence:Math.round((w.confidence||0.82)*100),
              personsDetected:workers.length, vehicleDetected:"Forklift",
              frameIndex:fr.frameIndex??idx, detections:fr.detections });
          }
        }
      });
    });
  });
  return events;
}

function extractFirstFrame(file) {
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const vid=document.createElement("video");
    vid.src=url; vid.muted=true; vid.crossOrigin="anonymous"; vid.preload="metadata";
    vid.onloadeddata=()=>{vid.currentTime=0.1;};
    vid.onseeked=()=>{
      const c=document.createElement("canvas"); c.width=vid.videoWidth||1280; c.height=vid.videoHeight||720;
      c.getContext("2d").drawImage(vid,0,0,c.width,c.height);
      URL.revokeObjectURL(url);
      resolve({dataUrl:c.toDataURL("image/jpeg",0.85),w:c.width,h:c.height,duration:vid.duration});
    };
    vid.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Cannot read video"));};
  });
}

// ─── SCROLLING VIDEO GALLERY ──────────────────────────────────────────────────
const ScrollingVideoGallery = ({ onSelectVideo }) => {
  const videos=[{id:1,url:"/safety_vid_1.mp4"},{id:2,url:"/safety_vid_2.mp4"},{id:3,url:"/safety_vid_3.mp4"},{id:4,url:"/safety_vid_4.mp4"}];
  const items=[...videos,...videos];
  const onEnter=e=>{const p=e.currentTarget.play();if(p)p.catch(()=>{});};
  const onLeave=e=>e.currentTarget.pause();
  return (
    <div className="video-scroller-container">
      <div className="video-track">
        {items.map((v,i)=>(
          <div key={`${v.id}-${i}`} className="video-card" onClick={()=>onSelectVideo(v.url)}>
            <video muted loop playsInline preload="metadata" onMouseEnter={onEnter} onMouseLeave={onLeave}>
              <source src={v.url} type="video/mp4"/>
            </video>
            <div className="video-card-overlay"><Lock size={13} style={{marginRight:5}}/> Select this sample</div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- LIVE FRAME CANVAS (real-time preview during analysis) ---------
const CM_LIVE={person:"#00ff00",forklift:"#00ff00",head:"#ff0000",helmet:"#00ff00"};

const LiveFrameCanvas=({videoUrl,detections,frameIndex})=>{
  const canvasRef=useRef(null);
  const videoRef=useRef(null);
  useEffect(()=>{
    if(!videoUrl||!canvasRef.current)return;
    const canvas=canvasRef.current;
    const ctx=canvas.getContext("2d");
    const seekTo=Math.max(0,frameIndex/5);
    if(!videoRef.current){
      const v=document.createElement("video");
      v.src=videoUrl;v.muted=true;v.crossOrigin="anonymous";v.preload="auto";
      videoRef.current=v;
    }
    const video=videoRef.current;
    const draw=()=>{
      canvas.width=video.videoWidth||1280;
      canvas.height=video.videoHeight||720;
      ctx.drawImage(video,0,0,canvas.width,canvas.height);
      (detections||[]).forEach(d=>{
        if(!d.box)return;
        const[nx,ny,nw,nh]=d.box;
        const x=nx*canvas.width,y=ny*canvas.height,w=nw*canvas.width,h=nh*canvas.height;
        const col=CM_LIVE[(d.label||"").toLowerCase()]||"#6366f1";
        ctx.strokeStyle=col;ctx.lineWidth=2.5;ctx.strokeRect(x,y,w,h);
        const text=`${d.label}  ${Math.round((d.confidence||0)*100)}%`;
        const tw=ctx.measureText(text).width+10;
        ctx.fillStyle=col;
        ctx.beginPath();
        ctx.roundRect?ctx.roundRect(x,y-20,tw,20,3):ctx.fillRect(x,y-20,tw,20);
        ctx.fill();
        ctx.fillStyle="#fff";ctx.font="bold 11px Poppins,sans-serif";
        ctx.fillText(text,x+5,y-5);
      });
    };
    if(Math.abs(video.currentTime-seekTo)>0.15){video.onseeked=draw;video.currentTime=seekTo;}
    else{video.readyState>=2?draw():(video.onloadeddata=draw);}
  },[videoUrl,detections,frameIndex]);
  return<canvas ref={canvasRef} className="lp-live-canvas" style={{width:"100%",borderRadius:8,display:"block",background:"#0f172a"}}/>;
};

// ─── EVENT FRAME CANVAS ──────────────────────────────────────────────────────
// Seeks the uploaded video to the exact frame where an event occurred,
// draws the frame, then overlays all detection bounding boxes on top.
const CM_EVT = { person:"#ef4444", forklift:"#f59e0b", head:"#a855f7", helmet:"#22c55e" };

const EventFrameCanvas = ({ videoUrl, frameIndex, detections }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!videoUrl || !canvasRef.current) return;

    const canvas  = canvasRef.current;
    const ctx     = canvas.getContext("2d");
    const FPS     = 5; // must match backend extraction fps
    const seekTo  = Math.max(0, (frameIndex / FPS) - 0.05);

    const video         = document.createElement("video");
    video.src           = videoUrl;
    video.muted         = true;
    video.crossOrigin   = "anonymous";
    video.preload       = "auto";

    const drawFrame = () => {
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Draw every detection box for this frame
      (detections || []).forEach(d => {
        if (!d.box) return;
        const [nx, ny, nw, nh] = d.box;
        const x  = nx * canvas.width;
        const y  = ny * canvas.height;
        const w  = nw * canvas.width;
        const h  = nh * canvas.height;
        const lbl = (d.label || "").toLowerCase();
        const col = CM_EVT[lbl] || "#6366f1";

        // Glowing box
        ctx.shadowColor  = col;
        ctx.shadowBlur   = 8;
        ctx.strokeStyle  = col;
        ctx.lineWidth    = 2.5;
        ctx.strokeRect(x, y, w, h);
        ctx.shadowBlur   = 0;
        ctx.shadowColor  = "transparent";

        // Label pill
        ctx.font = "bold 12px Poppins,sans-serif";
        const text = `${d.label}  ${Math.round((d.confidence || 0) * 100)}%`;
        const tw   = ctx.measureText(text).width + 12;
        ctx.fillStyle = col;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y - 22, tw, 20, 3);
        else               ctx.rect(x, y - 22, tw, 20);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x + 6, y - 7);
      });

      // Timestamp watermark bottom-left
      const ts = `Frame ${frameIndex}  ·  ${FPS} fps`;
      ctx.font      = "11px monospace";
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(8, canvas.height - 26, ctx.measureText(ts).width + 12, 20);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(ts, 14, canvas.height - 11);
    };

    video.onseeked    = drawFrame;
    video.onloadeddata = () => { video.currentTime = seekTo; };
    // If already loaded (e.g. same video reused), seek directly
    if (video.readyState >= 2) video.currentTime = seekTo;
  }, [videoUrl, frameIndex, detections]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width:"100%", borderRadius:8, display:"block", background:"#0f172a" }}
    />
  );
};

// ─── EVENT DETAIL MODAL ───────────────────────────────────────────────────────
const EventModal = ({ event, onClose, videoUrl }) => {
  if(!event) return null;
  const conf = event.confidence ?? 91;
  const isCompliant = event.ppeStatus === "Compliant";
  const sevColor = SEV_COLORS[event.severity] || "#64748b";
  const sevBg    = SEV_BG[event.severity]    || "rgba(100,116,139,0.1)";
  const TypeIcon = METRICS.find(m=>m.label.includes(event.eventType.split(" ")[0]))?.icon || AlertTriangle;
  return (
    <div className="ev-modal-overlay" onClick={onClose}>
      <div className="ev-modal-content" onClick={e=>e.stopPropagation()}>
        <div className="ev-modal-header">
          <h2>Event Details <span className="ev-modal-id">#{event.id}</span></h2>
          <button className="ev-close-btn" onClick={onClose}><X size={22}/></button>
        </div>
        <div className="ev-modal-body">
          {/* LEFT — video/thumb */}
          <div className="ev-modal-left">
            <div className="ev-video-container">
              {/* Show the actual annotated frame where the event occurred */}
              {event.frameIndex != null && event.detections
                ? <EventFrameCanvas
                    videoUrl={videoUrl}
                    frameIndex={event.frameIndex}
                    detections={event.detections}
                  />
                : <img
                    src={`https://placehold.co/800x450/0f172a/94a3b8?text=${encodeURIComponent(event.eventType)}`}
                    alt="Event frame"
                    style={{width:"100%",borderRadius:8}}
                  />
              }
              <div className="ev-modal-type-chip">
                <TypeIcon size={12}/> {event.eventType}
              </div>
            </div>
            {/* AI Confidence */}
            <div className="ev-confidence-section">
              <span className="ev-conf-label">AI Confidence Score</span>
              <div className="ev-confidence-bar">
                <div className="ev-confidence-fill" style={{
                  width:`${conf}%`,
                  background: conf>=90?"#22c55e":conf>=70?"#f59e0b":"#ef4444"
                }}/>
                <span>{conf}%</span>
              </div>
            </div>
            <div className="ev-modal-actions">
              <button className="ev-primary-btn"><Download size={15}/> Download Clip</button>
              <button className="ev-secondary-btn"><FileText size={15}/> Download Report</button>
            </div>
          </div>
          {/* RIGHT — metadata */}
          <div className="ev-modal-right">
            <h3>Event Metadata</h3>
            <div className="ev-metadata-grid">
              <div className="ev-meta-item">
                <span className="ev-meta-label">Timestamp</span>
                <span className="ev-meta-value">{event.timestamp}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Camera Source</span>
                <span className="ev-meta-value">{event.camera}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Rule Violated</span>
                <span className="ev-meta-value">{event.eventType}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Zone</span>
                <span className="ev-meta-value">{event.zone}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Severity Level</span>
                <span className="ev-sev-badge" style={{color:sevColor,background:sevBg}}>{event.severity}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">PPE Status</span>
                <span className={`ev-status-badge ${isCompliant?"success":"danger"}`}>{event.ppeStatus}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Exposure Duration</span>
                <span className="ev-meta-value ev-text-danger">{event.exposure}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Persons Detected</span>
                <span className="ev-meta-value">{event.personsDetected ?? 2}</span>
              </div>
              <div className="ev-meta-item">
                <span className="ev-meta-label">Vehicle Detected</span>
                <span className="ev-meta-value">{event.vehicleDetected || "Forklift"}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const STAGE = {IDLE:"idle",METRICS:"metrics",ANNOTATE:"annotate",ANALYZING:"analyzing",RESULTS:"results"};

// ═══════════════════════════════════════════════════════════════════════════════
export default function LandingPage() {
  const navigate = useNavigate();

  // ── Auth ────────────────────────────────────────────────────────────────────
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("nava_user")) ||
             JSON.parse(localStorage.getItem("userData")) || null;
    } catch { return null; }
  });
  const [showEmailGate, setShowEmailGate] = useState(false);

  // ── Workbench ───────────────────────────────────────────────────────────────
  const [stage,setStage]         = useState(STAGE.IDLE);
  const fileInputRef              = useRef(null);
  const sampleVideoInputRef       = useRef(null);
  const [videoFile,setVideoFile] = useState(null);
  const [videoUrl,setVideoUrl]   = useState(null);
  const [frame,setFrame]         = useState(null);
  const [videoErr,setVideoErr]   = useState("");

  // ── Drawing ─────────────────────────────────────────────────────────────────
  const canvasRef   = useRef(null);
  const frameImgRef = useRef(null);
  const [tool,setTool]         = useState("edit");
  const [drawings,setDrawings] = useState([]);
  const [drawing,setDrawing]   = useState(false);
  const [curPts,setCurPts]     = useState([]);
  const [drag,setDrag]         = useState(null);
  const [sel,setSel]           = useState(null);

  // ── Analysis ────────────────────────────────────────────────────────────────
  const [selMetrics,setSelMetrics] = useState(["ppe_compliance"]);
  const [frames,setFrames]         = useState([]);
  const [analytics,setAnalytics]   = useState(null);
  const [processedUrl,setProcUrl]  = useState(null);
  const [analyzeErr,setAnalyzeErr] = useState("");
  const [liveFrame,setLiveFrame]   = useState(null);

  // ── Event Explorer state ────────────────────────────────────────────────────
  const [selectedEvent,setSelectedEvent] = useState(null);
  const [evFilters,setEvFilters] = useState({
    eventType:"All Types", severity:"All", ppeStatus:"All", camera:"All Cameras"
  });
  const [evSearch,setEvSearch] = useState("");

  // (pendingVideo effect removed — handled inline via pendingAction state)

  const requireAuth=()=>{
    if(user)return true;
    setShowEmailGate(true);
    return false;
  };

  // Called by EmailGateModal — save user, close modal.
  // User is now authenticated and can pick a gallery video or upload their own.
  const handleEmailSuccess = (userData) => {
    setUser(userData);
    setShowEmailGate(false);
  };

  const handleLogout=()=>{
    localStorage.removeItem("nava_user"); localStorage.removeItem("userData");
    setUser(null); setStage(STAGE.IDLE);
    setVideoFile(null);setVideoUrl(null);setFrame(null);setDrawings([]);
    setFrames([]);setAnalytics(null);setProcUrl(null);frameImgRef.current=null;
  };

  // ── Try another sample video (in-page, resets all analytics) ───────────────
  const handleSampleVideoChange = async e => {
    const file = e.target.files[0]; if (!file) return;
    // Reset the input so same file can be re-selected
    e.target.value = "";
    setVideoErr("");
    try {
      const fr = await extractFirstFrame(file);
      if (fr.duration > MAX_VIDEO_SECONDS + 0.5) {
        setVideoErr(`Video is ${Math.round(fr.duration)}s — max ${MAX_VIDEO_SECONDS}s allowed.`);
        return;
      }
      // Reset all analytics & events state
      setFrames([]); setAnalytics(null); setProcUrl(null); setAnalyzeErr("");
      setLiveFrame(null);
      setEvFilters({eventType:"All Types",severity:"All",ppeStatus:"All",camera:"All Cameras"});
      setEvSearch("");
      setSelectedEvent(null);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setFrame({dataUrl:fr.dataUrl,w:fr.w,h:fr.h});
      setDrawings([]); setCurPts([]); setDrawing(false); setSel(null); frameImgRef.current=null;
      setStage(STAGE.METRICS);
    } catch { setVideoErr("Could not read video. Try another file."); }
  };

  // ── Canvas ──────────────────────────────────────────────────────────────────
  useEffect(()=>{
    if(!frame?.dataUrl)return;
    const img=new Image();
    img.onload=()=>{frameImgRef.current=img;paint();};
    img.src=frame.dataUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[frame]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{paint(curPts);},[drawings,tool,sel,curPts,stage]);

  useEffect(()=>{
    if(stage!==STAGE.ANNOTATE)return;
    const onKey=e=>{
      if(e.key==="Escape"){setDrawing(false);setCurPts([]);setSel(null);setDrag(null);}
      if(e.key==="Enter"&&tool==="poly"&&drawing&&curPts.length>2){
        e.preventDefault();
        const lbl=window.prompt("Name this zone (optional):")||"";
        setDrawings(p=>[...p,{type:"poly",points:curPts,color:"#007FFF",label:lbl}]);
        setCurPts([]);setDrawing(false);
      }
      if(e.key==="Delete"&&sel!==null){setDrawings(p=>p.filter((_,i)=>i!==sel));setSel(null);}
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[stage,tool,drawing,curPts,sel]);

  const paint=(tmp=[])=>{
    const c=canvasRef.current;if(!c)return;
    const ctx=c.getContext("2d");ctx.clearRect(0,0,c.width,c.height);
    if(frameImgRef.current)ctx.drawImage(frameImgRef.current,0,0,c.width,c.height);
    else{ctx.fillStyle="#0f172a";ctx.fillRect(0,0,c.width,c.height);}
    drawings.forEach((d,idx)=>{
      const isSel=tool==="edit"&&idx===sel;
      ctx.strokeStyle=d.color;ctx.lineWidth=isSel?3.5:2.5;
      ctx.shadowColor=isSel?"rgba(255,255,255,0.8)":"transparent";ctx.shadowBlur=isSel?10:0;
      ctx.beginPath();
      if(d.type==="line"){ctx.moveTo(d.points[0].x,d.points[0].y);ctx.lineTo(d.points[1].x,d.points[1].y);}
      else{ctx.moveTo(d.points[0].x,d.points[0].y);d.points.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.closePath();ctx.fillStyle=`${d.color}22`;ctx.fill();}
      ctx.stroke();ctx.shadowColor="transparent";ctx.shadowBlur=0;
      d.points.forEach(pt=>{ctx.fillStyle=d.color;ctx.beginPath();ctx.arc(pt.x,pt.y,isSel?6:4,0,2*Math.PI);ctx.fill();if(isSel){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();}});
      if(d.label){const a=d.points[0];ctx.font="bold 12px Poppins,sans-serif";const tw=ctx.measureText(d.label).width;ctx.fillStyle="rgba(0,0,0,0.75)";ctx.roundRect?ctx.roundRect(a.x+10,a.y-24,tw+14,22,4):ctx.fillRect(a.x+10,a.y-24,tw+14,22);ctx.fill();ctx.fillStyle="#fff";ctx.fillText(d.label,a.x+17,a.y-8);}
    });
    if(tmp.length>0){ctx.strokeStyle=tool==="line"?"#EF4444":"#007FFF";ctx.lineWidth=2.5;ctx.setLineDash([6,5]);ctx.beginPath();ctx.moveTo(tmp[0].x,tmp[0].y);tmp.slice(1).forEach(p=>ctx.lineTo(p.x,p.y));ctx.stroke();ctx.setLineDash([]);tmp.forEach(p=>{ctx.fillStyle=tool==="line"?"#EF4444":"#007FFF";ctx.beginPath();ctx.arc(p.x,p.y,5,0,2*Math.PI);ctx.fill();});}
  };

  const gpos=e=>{const c=canvasRef.current;if(!c)return{x:0,y:0};const r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*(c.width/r.width),y:(e.clientY-r.top)*(c.height/r.height)};};
  const onMD=e=>{
    if(e.button!==0)return;const{x,y}=gpos(e);
    if(tool==="edit"){
      for(let di=drawings.length-1;di>=0;di--){
        for(let pi=0;pi<drawings[di].points.length;pi++){const p=drawings[di].points[pi];if(Math.hypot(p.x-x,p.y-y)<=12){setDrag({type:"pt",di,pi});setSel(di);return;}}
        const d=drawings[di],xs=d.points.map(p=>p.x),ys=d.points.map(p=>p.y),pad=d.type==="line"?15:0;
        if(x>=Math.min(...xs)-pad&&x<=Math.max(...xs)+pad&&y>=Math.min(...ys)-pad&&y<=Math.max(...ys)+pad){setDrag({type:"sh",di,ox:x,oy:y});setSel(di);return;}
      }
      setSel(null);return;
    }
    if(tool==="line"){if(!drawing){setCurPts([{x,y}]);setDrawing(true);}else if(curPts.length===1){const pts=[...curPts,{x,y}];const lbl=window.prompt("Name this line (optional):")||"";setDrawings(p=>[...p,{type:"line",points:pts,color:"#EF4444",label:lbl}]);setCurPts([]);setDrawing(false);}return;}
    if(tool==="poly"){setCurPts(p=>[...p,{x,y}]);setDrawing(true);}
  };
  const onMM=e=>{const{x,y}=gpos(e);if(drag){setDrawings(prev=>prev.map((d,i)=>{if(i!==drag.di)return d;if(drag.type==="pt"){const pts=[...d.points];pts[drag.pi]={x,y};return{...d,points:pts};}const dx=x-drag.ox,dy=y-drag.oy;setDrag(p2=>({...p2,ox:x,oy:y}));return{...d,points:d.points.map(p=>({x:p.x+dx,y:p.y+dy}))};}))}else if(drawing)paint([...curPts,{x,y}]);};
  const onMU=()=>{if(drag)setDrag(null);};
  const finishPoly=()=>{if(curPts.length>2){const lbl=window.prompt("Name this zone (optional):")||"";setDrawings(p=>[...p,{type:"poly",points:curPts,color:"#007FFF",label:lbl}]);setCurPts([]);setDrawing(false);}};

  const handleFile=async e=>{
    const file=e.target.files[0];if(!file)return;
    setVideoErr("");
    try{
      const fr=await extractFirstFrame(file);
      if(fr.duration>MAX_VIDEO_SECONDS+0.5){setVideoErr(`Video is ${Math.round(fr.duration)}s — max ${MAX_VIDEO_SECONDS}s allowed.`);return;}
      setVideoFile(file);setVideoUrl(URL.createObjectURL(file));
      setFrame({dataUrl:fr.dataUrl,w:fr.w,h:fr.h});
      setDrawings([]);setCurPts([]);setDrawing(false);setSel(null);frameImgRef.current=null;
      setStage(STAGE.METRICS);
      setTimeout(()=>document.getElementById("demo")?.scrollIntoView({behavior:"smooth"}),100);
    }catch{setVideoErr("Could not read video. Try another file.");}
  };

  const loadGalleryVideo=url=>{
    setVideoUrl(url);setVideoFile(null);setFrame(null);frameImgRef.current=null;
    setDrawings([]);setCurPts([]);setDrawing(false);setSel(null);
    const vid=document.createElement("video");
    vid.src=url;vid.muted=true;vid.crossOrigin="anonymous";vid.preload="metadata";
    vid.onloadeddata=()=>{vid.currentTime=0.1;};
    vid.onseeked=()=>{
      const c=document.createElement("canvas");c.width=vid.videoWidth||1280;c.height=vid.videoHeight||720;
      c.getContext("2d").drawImage(vid,0,0,c.width,c.height);
      setFrame({dataUrl:c.toDataURL("image/jpeg",0.85),w:c.width,h:c.height});
      setStage(STAGE.METRICS);
      setTimeout(()=>document.getElementById("demo")?.scrollIntoView({behavior:"smooth"}),100);
    };
  };

  const runAnalysis = async () => {
    if (!selMetrics.length) return;

    setStage(STAGE.ANALYZING);
    setAnalyzeErr("");
    setFrames([]);
    setLiveFrame(null);

    const CM = {
      Person:"#ef4444",  person:"#ef4444",
      Forklift:"#f59e0b",forklift:"#f59e0b",
      Head:"#a855f7",    head:"#a855f7",
      Helmet:"#007FFF",  helmet:"#007FFF",
    };
    const LD = { person:"Person", forklift:"Forklift", head:"Head", helmet:"Helmet" };

    const formatFrame = (fr) => ({
      frameIndex: fr.frameIndex,
      timestamp:  fr.timestamp,
      detections: (fr.detections || []).map(d => ({
        label:      LD[String(d.label || "").toLowerCase()] || d.label,
        color:      CM[d.label] || "#22C55E",
        box:        d.box,
        confidence: d.confidence,
        inZone:     d.in_zone || false,
      })),
    });

    try {
      // ── Normalise zones ──────────────────────────────────────────────────────
      const c  = canvasRef.current;
      const cw = c?.width  || 1280;
      const ch = c?.height || 720;
      const normZones = drawings.map(d => ({
        type:   d.type,
        label:  d.label || "",
        color:  d.color,
        points: d.points.map(p => ({ x: p.x / cw, y: p.y / ch })),
      }));

      // ── STEP 1: Upload video ─────────────────────────────────────────────────
      // Gallery videos arrive as a URL that the browser may serve as webm/VP8,
      // which OpenCV cannot decode. Always upload the original File when we have
      // it; only fall back to blob-fetch for public sample URLs, and force the
      // filename to .mp4 so the backend treats it as MP4.
      const fd = new FormData();

      if (videoFile) {
        // User-uploaded file — use as-is (browser preserves the original codec)
        fd.append("video", videoFile, videoFile.name);
      } else if (videoUrl) {
        // Gallery / sample URL — fetch as blob
        const resp = await fetch(videoUrl);
        const blob = await resp.blob();
        // Force .mp4 extension so the backend's OpenCV picks the right decoder.
        // If the server actually serves MP4 this is a no-op; if it re-encodes
        // to webm in-memory, the backend will still see the right container.
        fd.append("video", blob, "sample_feed.mp4");
      } else {
        throw new Error("No video selected.");
      }

      fd.append("zones",       JSON.stringify(normZones));
      fd.append("metrics",     JSON.stringify(selMetrics));
      if (user) {
        fd.append("userEmail",   user.email   || "");
        fd.append("userName",    user.name    || "");
        fd.append("userCompany", user.company || "");
      }

      const token = user?.token || "";
      const uploadResp = await fetch(`${BACKEND_URL}/api/upload`, {
        method:  "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body:    fd,
      });
      if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
      const { videoId } = await uploadResp.json();

      // ── STEP 2: Trigger analysis (returns jobId) ─────────────────────────────
      const analyzeResp = await fetch(`${BACKEND_URL}/api/analyze`, {
        method:  "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          videoId,
          zones:           normZones,
          metrics:         selMetrics,
          selectedMetrics: selMetrics.join(","), // stored in jobs.selected_metrics e.g. "ppe_compliance,near_miss"
          userEmail:       user?.email || "",    // company email tied to this job
        }),
      });
      if (!analyzeResp.ok) throw new Error(`Analyze failed: ${analyzeResp.status}`);
      const { jobId } = await analyzeResp.json();

      // ── STEP 3: Open WebSocket to receive real-time frame results ────────────
      // Backend route: ws(s)://host/api/ws/detect?jobId=...&token=...
      const wsBase = BACKEND_URL.replace(/^http/, "ws");
      const wsUrl  = `${wsBase}/api/ws/detect?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`;
      const socket = new WebSocket(wsUrl);

      // Reconnect timer ref (scoped to this analysis run)
      let reconnectHandle = null;
      let closed = false;

      const cleanup = () => {
        closed = true;
        if (reconnectHandle) clearTimeout(reconnectHandle);
        if (socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING) {
          socket.close(1000);
        }
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          switch (msg.type) {
            case "frame": {
              const ff = formatFrame(msg);
              setFrames(prev => [...prev, ff]);
              setLiveFrame({
                frameIndex: ff.frameIndex,
                timestamp:  ff.timestamp,
                detections: ff.detections,
                metrics:    msg.metrics || {},
              });
              break;
            }
            case "complete": {
              cleanup();
              if (msg.processedUrl) setProcUrl(msg.processedUrl);
              setStage(STAGE.RESULTS);
              break;
            }
            case "error": {
              cleanup();
              console.error("WS analysis error:", msg.error);
              // Still show results with whatever frames arrived
              setStage(STAGE.RESULTS);
              break;
            }
            default:
              break;
          }
        } catch (err) {
          console.error("WS parse error:", err, event.data);
        }
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
      };

      socket.onclose = (e) => {
        if (closed) return; // intentional close — do nothing
        if (e.code !== 1000 && e.code !== 1001) {
          // Unexpected close — move to results with whatever we have
          console.warn("WebSocket closed unexpectedly:", e.code, e.reason);
          setStage(prev => prev === STAGE.ANALYZING ? STAGE.RESULTS : prev);
        }
      };

    } catch (err) {
      console.error("Analysis error:", err);
      setAnalyzeErr(err.message);
      setStage(STAGE.ANNOTATE);
    }
  };

  // ── Derived data ────────────────────────────────────────────────────────────
  const M = frames.length>0 ? computeMetrics(frames,analytics) : null;
  const eventList = useMemo(()=>frames.length>0?buildEventList(frames):[], [frames]);

  const filteredEvents = useMemo(()=>eventList.filter(e=>{
    if(evFilters.eventType!=="All Types" && e.eventType!==evFilters.eventType) return false;
    if(evFilters.severity!=="All"        && e.severity!==evFilters.severity)   return false;
    if(evFilters.ppeStatus!=="All"       && e.ppeStatus!==evFilters.ppeStatus) return false;
    if(evSearch && !e.eventType.toLowerCase().includes(evSearch.toLowerCase())
                && !e.id.toLowerCase().includes(evSearch.toLowerCase())
                && !e.zone.toLowerCase().includes(evSearch.toLowerCase())) return false;
    return true;
  }),[eventList,evFilters,evSearch]);

  const metricCards=M?[
    {
      id:"near_miss", label:"Near-Miss Incidents", primary:true,
      color:"#ef4444", icon:AlertTriangle,
      value: M.nearMiss,
      sub:   M.nearMiss===0 ? "No incidents detected"
           : `${M.nmRate}/min  ·  avg ${M.nmAvgDur}s each`,
      detail: `${M.nearMiss} incident${M.nearMiss!==1?"s":""} in ${M.duration}s of footage`,
    },
    {
      id:"pedestrian_exposure", label:"Pedestrian Exposure",
      color:"#f59e0b", icon:Truck,
      value: M.exposure,
      sub:   M.exposure===0 ? "No exposure detected"
           : `${M.expRate}/min  ·  avg ${M.expAvgDur}s each`,
      detail: `Worker in forklift proximity ${M.exposure} time${M.exposure!==1?"s":""}`,
    },
    {
      id:"zone_violation", label:"Zone Violations",
      color:"#a855f7", icon:MapPin,
      value: M.zv,
      sub:   M.zv===0 ? "No violations detected"
           : `${M.zvRate}/min  ·  avg ${M.zvAvgDur}s each`,
      detail: `${M.zv} entry event${M.zv!==1?"s":""} into restricted zones`,
    },
    {
      id:"ppe_compliance", label:"PPE Compliance",
      color: M.ppe===null ? "#64748b" : M.ppe>=90?"#22c55e":M.ppe>=70?"#f59e0b":"#ef4444",
      icon:ShieldCheck,
      value: M.ppe!==null ? `${M.ppe}%` : "—",
      sub:   M.ppe===null ? "No workers detected"
           : M.ppe>=90    ? "Excellent — target met"
           : M.ppe>=70    ? "Below target — improvement needed"
           : "Critical — immediate action required",
      detail: M.ppeViolations>0
        ? `${M.ppeViolations} violation incident${M.ppeViolations!==1?"s":""} · ${M.uniqueWorkers} worker${M.uniqueWorkers!==1?"s":""} observed`
        : `${M.uniqueWorkers} worker${M.uniqueWorkers!==1?"s":""} observed, all compliant`,
    },
  ].filter(m=>selMetrics.includes(m.id)):[];

  const pieData=M?[{name:"Near-Miss",value:M.nearMiss,color:"#ef4444"},{name:"Ped. Exposure",value:M.exposure,color:"#f59e0b"},{name:"Zone Violations",value:M.zv,color:"#a855f7"}].filter(d=>d.value>0&&selMetrics.some(s=>d.name.toLowerCase().replace("-","_").includes(s.split("_")[0]))):[];
  const chartLines=selMetrics.map(id=>{const m=METRICS.find(x=>x.id===id);const km={near_miss:"Near-Miss",pedestrian_exposure:"Ped. Exposure",zone_violation:"Zone Violations",ppe_compliance:"PPE Compliance"};return{id,color:m.color,dataKey:km[id]};});

  // Export events to CSV
  const exportEvents=()=>{
    if(!filteredEvents.length){alert("No events to export.");return;}
    const headers=["Event ID","Timestamp","Event Type","Severity","Exposure","PPE Status","Camera","Zone","Confidence"];
    const csv=[headers.join(","),...filteredEvents.map(e=>[e.id,e.timestamp,e.eventType,e.severity,e.exposure,e.ppeStatus,e.camera,e.zone,e.confidence+"%"].join(","))].join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download=`nava-events-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="landing-page">

      {/* NAVBAR */}
      <nav className="landing-navbar">
        <div className="landing-nav-container">
          <img src="/nava-logo.png" alt="NAVA" className="landing-logo" onError={e=>{e.target.style.display="none";}}/>
          <div className="landing-nav-links">
            <a href="#features">Features</a>
            <a href="#demo">Try Demo</a>
          </div>
          <div className="landing-nav-actions">
            {user?(
              <div className="nav-user-info">
                <span className="nav-user-name">{user.name}</span>
                <button className="nav-logout-btn" onClick={handleLogout}><LogOut size={15}/> Logout</button>
              </div>
            ):(
              <button className="landing-btn-primary" onClick={()=>setShowEmailGate(true)}>Analyze My Footage</button>
            )}
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section className="landing-hero">
        <div className="hero-container">
          {/* <div className="hero-badge animate-fade-in"><Zap size={14} className="hero-badge-icon"/> AI-Powered Workplace Safety</div> */}
          <h1 className="animate-slide-up">Hidden safety risks are already in your camera feeds <br/>
            <span className="text-gradient">AI helps you see them </span>
          </h1>
          <p className="hero-subtitle animate-slide-up">Detect near-miss forklift interactions, pedestrian exposure, restricted zone violations, and PPE compliance gaps from your existing camera footage and generate a safety snapshot instantly.</p>
          <div className="hero-cta-group animate-slide-up">
            <button className="landing-btn-primary btn-lg" onClick={()=>{if(!requireAuth())return;document.getElementById("demo")?.scrollIntoView({behavior:"smooth"});}}>
             Analyze My Footage<ArrowRight size={18}/>
            </button>
          </div>
        </div>
      </section>

      {/* DEMO SECTION */}
      <section id="demo" className="landing-demo-section">
        <div className="section-header">
          <h2>Run your  <span className="text-gradient">Safety Snapshot </span> in minutes</h2>
          <p>Upload a short video from your facility or select from the below sample camera feeds and get a clear view of safety risks, exposure patterns, and compliance gaps - instantly.</p>
        </div>

        <div className="workbench-wrapper">

          {/* IDLE */}
          {stage===STAGE.IDLE&&(
            <div className={`demo-upload-placeholder${!user?" is-locked":""}`}
              onClick={()=>{if(!requireAuth())return;fileInputRef.current?.click();}}>
              <input ref={fileInputRef} type="file" accept="video/*" style={{display:"none"}} onChange={handleFile}/>
              {!user?(
                <>
                  <div className="lock-icon-wrapper"><Lock size={36}/></div>
                  <p className="lock-title">Upload your safety footage</p>
                  <p className="lock-subtitle">Drag and drop a short video or select a sample from below to analyze risks. (max {MAX_VIDEO_SECONDS}s).</p>
                  <button className="landing-btn-primary" style={{marginTop:"1.25rem"}} onClick={e=>{e.stopPropagation();setShowEmailGate(true);}}>
                    Continue with Work Email
                  </button>
                </>
              ):(
                <>
                  <Upload size={40} className="text-gradient" style={{marginBottom:"1rem"}}/>
                  <p>Upload your safety footage (max {MAX_VIDEO_SECONDS}s)</p>
                  <p style={{fontSize:"0.82rem",color:"var(--text-muted)",marginTop:"0.25rem"}}>Drag and drop a short video or select a sample from below to analyze risks.</p>
                  {videoErr&&<p className="lp-upload-error">{videoErr}</p>}
                </>
              )}
            </div>
          )}

          {/* STEP 1 — PICK USE CASES (shown immediately after video is chosen) */}
          {stage===STAGE.METRICS&&(
            <div className="lp-wb-panel lp-metrics-panel">
              <div className="lp-wb-topbar">
                <span className="lp-upload-fname">📹 {videoFile?.name||"Gallery feed"}</span>
                <button className="lp-change-btn" onClick={()=>{setStage(STAGE.IDLE);setFrame(null);setVideoFile(null);setVideoUrl(null);frameImgRef.current=null;}}>✕ Change Video</button>
              </div>
              <h4>What do you want to detect?</h4>
              <p className="lp-metrics-desc">Pick the safety risks you want the AI to look for in this footage.</p>
              <div className="lp-metric-selector">
                {METRICS.map(m=>{
                  const active=selMetrics.includes(m.id);
                  return(
                    <button key={m.id} className={`lp-metric-btn ${active?"active":""} ${m.isPrimary?"primary-metric":""}`}
                     style={active ? {
                       borderColor: "#22c55e",
                       background: "rgba(34,197,94,0.15)"
                     } : {}}
                      onClick={()=>setSelMetrics(p=>p.includes(m.id)?p.filter(x=>x!==m.id):[...p,m.id])}>
                      <span className="lp-metric-check">{active?<CheckSquare size={13}/>:<Square size={13}/>}</span>
                      <m.icon size={15} style={{color:active?m.color:undefined}}/>
                      <span className="lp-metric-text">{m.label}{m.isPrimary&&<span className="wb-primary-badge">Primary</span>}</span>
                    </button>
                  );
                })}
              </div>
              <div className="lp-stage-nav lp-stage-nav-right">
                {selMetrics.includes("zone_violation")&&(
                  <button className="lp-zone-btn" onClick={()=>setStage(STAGE.ANNOTATE)}>
                    <Hexagon size={15}/> Draw Restricted Zones
                  </button>
                )}
                <button className="landing-btn-primary" disabled={!selMetrics.length} onClick={runAnalysis}>
                  <Zap size={15}/> Run Analysis
                </button>
              </div>
            </div>
          )}

          {/* ZONE DRAWING — optional, only when zone_violation is selected */}
          {stage===STAGE.ANNOTATE&&(
            <div className="lp-wb-panel">
              <input ref={fileInputRef} type="file" accept="video/*" style={{display:"none"}} onChange={handleFile}/>
              <div className="lp-wb-topbar">
                <span className="lp-upload-fname">📹 {videoFile?.name||"Gallery feed"} · Restricted Zone Mapping</span>
                <button className="lp-change-btn" onClick={()=>setStage(STAGE.METRICS)}>← Back</button>
              </div>
              <div className="lp-draw-toolbar">
                <div className="lp-tool-group">
                  {[{id:"edit",Icon:MousePointer2,label:"Select"},{id:"line",Icon:Ruler,label:"Trip Line"},{id:"poly",Icon:Hexagon,label:"Zone Polygon"}].map(({id,Icon,label})=>(
                    <button key={id} className={`cm-tool-btn ${tool===id?"active":""}`} onClick={()=>{setTool(id);setDrawing(false);setCurPts([]);setSel(null);}}>
                      <Icon size={14}/> {label}
                    </button>
                  ))}
                  {tool==="poly"&&drawing&&curPts.length>2&&<button className="cm-tool-btn finish" onClick={finishPoly}><Check size={14}/> Finish Zone</button>}
                  {tool==="edit"&&sel!==null&&<button className="cm-tool-btn delete" onClick={()=>{setDrawings(p=>p.filter((_,i)=>i!==sel));setSel(null);}}><Trash2 size={14}/> Delete</button>}
                  {drawings.length>0&&<button className="cm-tool-btn clear" onClick={()=>{setDrawings([]);setCurPts([]);setDrawing(false);setSel(null);}}><Trash2 size={14}/> Clear All</button>}
                </div>
                <span className="lp-zone-count">{drawings.length} zone{drawings.length!==1?"s":""} drawn</span>
              </div>
              <div className="lp-canvas-wrapper">
                <canvas ref={canvasRef} width={1280} height={720}
                  className={`lp-anno-canvas ${tool==="edit"?"cursor-grab":"cursor-crosshair"}`}
                  onMouseDown={onMD} onMouseMove={onMM} onMouseUp={onMU} onMouseLeave={onMU}/>
                <div className="lp-canvas-hint">
                  {tool==="edit"&&"Click shape to select · Drag to move · Delete key removes"}
                  {tool==="line"&&"Click once to start · Click again to finish trip line"}
                  {tool==="poly"&&!drawing&&"Click to place vertices · Finish Zone or Enter to close"}
                  {tool==="poly"&&drawing&&`${curPts.length} pts placed — Finish Zone or Enter · Esc to cancel`}
                </div>
              </div>
              {analyzeErr&&<p className="lp-upload-error">{analyzeErr}</p>}
              <div className="lp-stage-nav lp-stage-nav-right">
                <button className="landing-btn-primary" onClick={runAnalysis} disabled={!selMetrics.length}>
                  <Zap size={15}/> Run Analysis
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — INFERENCING: just the live canvas + subtle progress bar, no labels */}
          {stage===STAGE.ANALYZING&&(
            <div className="lp-wb-panel lp-live-analyzing">
              <div className="lp-live-frame-wrapper">
                {liveFrame ? (
                  <LiveFrameCanvas
                    videoUrl={videoUrl}
                    detections={liveFrame.detections}
                    frameIndex={liveFrame.frameIndex}
                  />
                ) : (
                  <div className="lp-live-placeholder">
                    <div className="wb-spinner" style={{width:36,height:36,borderWidth:3}}/>
                    <p>Preparing video...</p>
                  </div>
                )}
                <div className="lp-infer-overlay-bar">
                  <div className="wb-spinner lp-infer-spinner"/>
                  <div className="lp-live-progress-bar lp-infer-progress">
                    <div className="lp-live-progress-fill"
                      style={{width: frames.length > 0 ? `${Math.min((frames.length/150)*100,95)}%` : "4%"}}/>
                  </div>
                  <span className="lp-infer-frame-count">{frames.length} frames</span>
                </div>
              </div>
              {liveFrame && liveFrame.detections.length > 0 && (
                <div className="lp-live-dets">
                  {["person","forklift","helmet","head"].map(cls => {
                    const count = liveFrame.detections.filter(d=>(d.label||"").toLowerCase()===cls).length;
                    if(!count) return null;
                    const colors={person:"#00ff00",forklift:"#00ff00",helmet:"#00ff00",head:"#ff0000"};
                    return <span key={cls} className="lp-live-det-chip" style={{borderColor:colors[cls],color:colors[cls]}}>{count} {cls}{count>1?"s":""}</span>;
                  })}
                </div>
              )}
            </div>
          )}

          {/* RESULTS */}
          {stage===STAGE.RESULTS&&M&&(
            <div className="lp-results">

              {/* ── Header ── */}
              <div className="lp-results-header">
                <div className="lp-results-header-text">
                  <h4>Your Safety Snapshot</h4>
                  <p className="lp-results-subtext">AI-detected forklift risks and worker safety insights from your uploaded footage</p>
                  <span className="wb-report-badge">{M.total} frames · {eventList.length} events detected</span>
                  <p className="lp-snapshot-context">This snapshot is based on a short video. Continuous monitoring across cameras provides deeper safety insights and integrates with EHS platform.</p>
                </div>
                <div className="lp-results-header-actions">
                  <button className="wb-download-btn" onClick={()=>alert("PDF export coming soon!")}><Download size={15}/> Download Safety Snapshot</button>
                  <button className="lp-try-another-btn" onClick={()=>sampleVideoInputRef.current?.click()}>
                    <Play size={13}/> Try another sample video
                  </button>
                  <input ref={sampleVideoInputRef} type="file" accept="video/*" style={{display:"none"}} onChange={handleSampleVideoChange}/>
                </div>
              </div>

              {/* ── KPI cards ── */}
              <div className="lp-result-cards">
                {metricCards.map(m=>(
                  <div key={m.id} className={`wb-report-card${m.primary?" wb-report-card--primary":""}`} style={{borderTopColor:m.color}}>
                    <div className="wb-rc-top">
                      <m.icon size={18} style={{color:m.color}}/>
                      {m.primary&&<span className="wb-rc-primary-badge">Primary Metric</span>}
                    </div>
                    <div className="wb-rc-value" style={{color:m.color}}>{m.value}</div>
                    <div className="wb-rc-label">{m.label}</div>
                    <div className="wb-rc-sub">{m.sub}</div>
                    <div className="wb-rc-detail">{m.detail}</div>
                  </div>
                ))}
              </div>


              {/* ── EVENT EXPLORER ── */}
              <div className="ev-explorer-section">
                <div className="ev-explorer-header">
                  <div>
                    <h4 className="ev-explorer-title">Event Explorer</h4>
                    <p className="ev-explorer-sub">Search, filter, and review every detected safety incident</p>
                  </div>
                  <button className="ev-export-btn" onClick={exportEvents}>
                    <Download size={15}/> Export CSV
                  </button>
                </div>

                {/* Filter Panel */}
                <div className="ev-filter-panel">
                  <div className="ev-filter-header">
                    <Filter size={14}/>
                    <span>Filter Events</span>
                  </div>
                  <div className="ev-filter-grid">
                    <div className="ev-filter-group">
                      <label>Event Type</label>
                      <select value={evFilters.eventType} onChange={e=>setEvFilters(p=>({...p,eventType:e.target.value}))}>
                        <option>All Types</option>
                        <option>Near-Miss Event</option>
                        <option>Zone Violation</option>
                        <option>PPE Violation</option>
                        <option>Pedestrian Exposure</option>
                      </select>
                    </div>
                    <div className="ev-filter-group">
                      <label>Severity</label>
                      <select value={evFilters.severity} onChange={e=>setEvFilters(p=>({...p,severity:e.target.value}))}>
                        <option>All</option>
                        <option>High</option>
                        <option>Medium</option>
                        <option>Low</option>
                      </select>
                    </div>
                    <div className="ev-filter-group">
                      <label>PPE Status</label>
                      <select value={evFilters.ppeStatus} onChange={e=>setEvFilters(p=>({...p,ppeStatus:e.target.value}))}>
                        <option>All</option>
                        <option>Compliant</option>
                        <option>Non-Compliant</option>
                      </select>
                    </div>
                    <div className="ev-filter-group">
                      <label>Search</label>
                      <div className="ev-search-wrapper">
                        <Search size={13} className="ev-search-icon"/>
                        <input type="text" placeholder="Event type, zone…" className="ev-search-input"
                          value={evSearch} onChange={e=>setEvSearch(e.target.value)}/>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Events Table */}
                <div className="ev-table-container">
                  {filteredEvents.length===0?(
                    <div className="ev-empty-state">
                      <Eye size={28} strokeWidth={1.2}/>
                      <p>{eventList.length===0?"No events were detected in this video.":"No events match your current filters."}</p>
                    </div>
                  ):(
                    <table className="ev-table">
                      <thead>
                        <tr>
                          <th>Event ID</th>
                          <th>Timestamp</th>
                          <th>Event Type</th>
                          <th>Severity</th>
                          <th>PPE Status</th>
                          <th style={{textAlign:"right"}}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEvents.map(event=>{
                          const sevColor=SEV_COLORS[event.severity]||"#64748b";
                          const sevBg=SEV_BG[event.severity]||"rgba(100,116,139,0.1)";
                          const isCompliant=event.ppeStatus==="Compliant";
                          const TypeIcon=METRICS.find(m=>event.eventType.includes(m.shortLabel.split(" ")[0]))?.icon||AlertTriangle;
                          return(
                            <tr key={event.id} className="ev-table-row" onClick={()=>setSelectedEvent(event)}>
                              <td className="ev-id-col">{event.id}</td>
                              <td className="ev-text-secondary">{event.timestamp}</td>
                              <td>
                                <span className="ev-type-cell">
                                  <TypeIcon size={12} style={{color:sevColor,flexShrink:0}}/>
                                  {event.eventType}
                                </span>
                              </td>
                              <td>
                                <span className="ev-sev-badge" style={{color:sevColor,background:sevBg}}>
                                  {event.severity}
                                </span>
                              </td>
                              <td>
                                <span className={`ev-status-badge ${isCompliant?"success":"danger"}`}>
                                  {event.ppeStatus}
                                </span>
                              </td>
                              <td style={{textAlign:"right"}} onClick={e=>e.stopPropagation()}>
                                <button className="ev-view-btn" onClick={()=>setSelectedEvent(event)}>
                                  <Eye size={13}/> View
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>


              {/* ── AI PROCESSED VIDEO ── */}
              {processedUrl && (
                <div className="lp-processed-video-section">
                  <div className="lp-processed-video-header">
                    <div className="lp-processed-video-badge">
                      <Zap size={13}/> AI Processed
                    </div>
                    <h4 className="lp-processed-video-title">Annotated Safety Feed</h4>
                    <p className="lp-processed-video-sub">
                      Full video with AI-drawn bounding boxes for every detected person, forklift, helmet, and zone violation.
                    </p>
                  </div>
                  <div className="lp-processed-video-player">
                    <video
                      src={`${BACKEND_URL}${processedUrl}`}
                      controls
                      autoPlay={false}
                      loop
                      playsInline
                      className="lp-processed-video-el"
                    >
                      Your browser does not support the video tag.
                    </video>
                    <a
                      href={`${BACKEND_URL}${processedUrl}`}
                      download="nava-processed-feed.mp4"
                      className="lp-processed-download-btn"
                    >
                      <Download size={14}/> Download Annotated Evidence
                    </a>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>

        {/* VIDEO GALLERY */}
        <div className="scroller-label">Sample Safety Detections</div>
        <ScrollingVideoGallery onSelectVideo={url=>{if(!requireAuth())return;loadGalleryVideo(url);}}/>
      </section>

      {/* FEATURES */}
      <section id="features" className="landing-features">
        <div className="features-container">
          <div className="features-grid">
            {[
              {icon:Eye,          title:"Near-Miss Detection", desc:"Identify close interactions between forklifts and pedestrians before incidents occur."},
              {icon:ShieldCheck,  title:"Pedestrian Exposure Analysis",   desc:"Measure how often and how long workers are exposed to moving equipment."},
              {icon:AlertTriangle,title:"Restricted Zone Violations",      desc:"Detect unsafe entry into active forklift or vehicle zones."},
              {icon:BarChart3,    title:"PPE Compliance Monitoring",desc:"Track helmet and high-visibility vest compliance across activity zones."},
            ].map(f=>(
              <div key={f.title} className="feature-card animate-slide-up">
                <div className="feature-icon-wrapper"><f.icon size={24} className="feature-icon"/></div>
                <h3>{f.title}</h3><p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="footer-container"><p>© 2026 NAVA Software Solutions. All rights reserved.</p></div>
      </footer>

      {/* EVENT DETAIL MODAL */}
      {selectedEvent&&<EventModal event={selectedEvent} onClose={()=>setSelectedEvent(null)} videoUrl={videoUrl}/>}

      {/* EMAIL GATE MODAL */}
      {showEmailGate&&(
        <EmailGateModal
          onSuccess={handleEmailSuccess}
          onClose={()=>setShowEmailGate(false)}
        />
      )}
    </div>
  );
}