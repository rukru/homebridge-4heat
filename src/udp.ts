/**
 * UDP broadcast discovery and wake-up for 4HEAT PinKEY devices.
 * Sends CF4 broadcast on port 6666, listens for response on port 5555.
 * Also serves as a wake-up call — TCP port 80 becomes active after CF4 response.
 */

import dgram from 'node:dgram';
import type { DiscoveredDevice } from './types.js';
import { UDP_BROADCAST_PORT, UDP_LISTEN_PORT, UDP_TIMEOUT, UDP_MAX_RETRIES } from './settings.js';

export function parseCF4Response(data: string): DiscoveredDevice | null {
  // Expected: ["CF4","4","<device_id>","<device_name>","<ip>","OK"]
  // or variations like ["CF4","1","<device_id>","<device_name>","<ip>"]
  const trimmed = data.trim();
  if (!trimmed.startsWith('["CF4"')) {
    return null;
  }

  try {
    const inner = trimmed.slice(1, -1);
    const parts = inner.split('","');
    parts[0] = parts[0].replace(/^"/, '');
    parts[parts.length - 1] = parts[parts.length - 1].replace(/"$/, '');

    if (parts.length < 5) {
      return null;
    }

    return {
      id: parts[2],
      name: parts[3],
      ip: parts[4],
    };
  } catch {
    return null;
  }
}

function attemptDiscovery(timeout: number): Promise<DiscoveredDevice | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const sender = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      try { listener.close(); } catch { /* ignore */ }
      try { sender.close(); } catch { /* ignore */ }
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeout);

    listener.on('error', () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    });

    listener.on('message', (msg) => {
      const response = msg.toString('utf-8');
      const device = parseCF4Response(response);
      if (device) {
        clearTimeout(timer);
        cleanup();
        resolve(device);
      }
    });

    listener.bind(UDP_LISTEN_PORT, () => {
      sender.bind(() => {
        sender.setBroadcast(true);
        const cmd = Buffer.from('["CF4","0"]', 'utf-8');
        sender.send(cmd, 0, cmd.length, UDP_BROADCAST_PORT, '255.255.255.255', () => {
          try { sender.close(); } catch { /* ignore */ }
        });
      });
    });
  });
}

export async function wakeAndDiscover(
  maxRetries: number = UDP_MAX_RETRIES,
  timeout: number = UDP_TIMEOUT,
): Promise<DiscoveredDevice | null> {
  for (let i = 0; i < maxRetries; i++) {
    const device = await attemptDiscovery(timeout);
    if (device) {
      return device;
    }
  }
  return null;
}
