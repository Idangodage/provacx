/**
 * Interaction Scheduler
 *
 * rAF-based scheduler that batches high-frequency interaction updates
 * to approximately one commit per frame (16ms target).
 */

export interface FrameScheduler<T> {
    schedule: (payload: T) => void;
    flush: () => void;
    dispose: () => void;
}

export interface FrameSchedulerOptions {
    minFrameMs?: number;
}

export function createFrameScheduler<T>(
    apply: (payload: T) => void,
    options: FrameSchedulerOptions = {}
): FrameScheduler<T> {
    const minFrameMs = Math.max(options.minFrameMs ?? 16, 0);
    let pendingPayload: T | null = null;
    let frameHandle: number | null = null;
    let lastFlushTs = 0;

    const cancel = () => {
        if (frameHandle === null) return;
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(frameHandle);
        } else {
            clearTimeout(frameHandle);
        }
        frameHandle = null;
    };

    const request = (callback: (ts: number) => void): number => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            return window.requestAnimationFrame(callback);
        }
        return setTimeout(() => callback(Date.now()), minFrameMs) as unknown as number;
    };

    const doFlush = (nowTs: number) => {
        if (pendingPayload === null) {
            frameHandle = null;
            return;
        }

        if (minFrameMs > 0 && nowTs - lastFlushTs < minFrameMs) {
            frameHandle = request(doFlush);
            return;
        }

        const payload = pendingPayload;
        pendingPayload = null;
        lastFlushTs = nowTs;
        frameHandle = null;
        apply(payload);

        if (pendingPayload !== null) {
            frameHandle = request(doFlush);
        }
    };

    return {
        schedule: (payload) => {
            pendingPayload = payload;
            if (frameHandle !== null) return;
            frameHandle = request(doFlush);
        },
        flush: () => {
            if (pendingPayload === null) return;
            cancel();
            doFlush(Date.now());
        },
        dispose: () => {
            pendingPayload = null;
            cancel();
        },
    };
}
