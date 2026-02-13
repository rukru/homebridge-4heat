/**
 * UDP broadcast discovery and wake-up for 4HEAT PinKEY devices.
 * Sends CF4 broadcast on port 6666, listens for response on port 5555.
 * Also serves as a wake-up call — TCP port 80 becomes active after CF4 response.
 */
import type { DiscoveredDevice } from './types.js';
export declare function parseCF4Response(data: string): DiscoveredDevice | null;
export declare function wakeAndDiscover(maxRetries?: number, timeout?: number): Promise<DiscoveredDevice | null>;
