import { useRef, useCallback, useState } from 'react';

function resolveWsBaseUrl() {
  const envUrl = (process.env.REACT_APP_BACKEND_URL || '').trim();
  if (envUrl) return envUrl.replace(/\/$/, '').replace(/^http/i, 'ws');

  if (typeof window !== 'undefined') {
    const isLocalHost =
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';
    if (isLocalHost) return 'ws://localhost:8080';

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${window.location.host}`;
  }

  return 'ws://localhost:8080';
}

const WS_URL = resolveWsBaseUrl();

export function useDetectionStream() {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const [connected, setConnected] = useState(false);

  const connect = useCallback((jobId, { onFrame, onComplete, onError }) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const token = (() => {
      try {
        const user = JSON.parse(localStorage.getItem('nava_user'))
          || JSON.parse(localStorage.getItem('userData'));
        return user?.token || '';
      } catch { return ''; }
    })();

    const url = `${WS_URL}/api/ws/detect?jobId=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);

    socket.onopen = () => {
      setConnected(true);
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case 'frame':
            if (onFrame) onFrame(msg);
            break;
          case 'complete':
            if (onComplete) onComplete(msg);
            break;
          case 'error':
            if (onError) onError(msg.error || 'Unknown error');
            break;
          default:
            break;
        }
      } catch (err) {
        console.error('ws parse error:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('ws error:', err);
      if (onError) onError('WebSocket connection error');
    };

    socket.onclose = (e) => {
      setConnected(false);
      if (e.code !== 1000 && e.code !== 1001) {
        reconnectTimer.current = setTimeout(() => {
          connect(jobId, { onFrame, onComplete, onError });
        }, 3000);
      }
    };

    wsRef.current = socket;
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000);
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  return { connect, disconnect, connected };
}