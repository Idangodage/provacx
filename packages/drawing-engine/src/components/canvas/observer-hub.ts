/**
 * Observer Hub
 *
 * Small observer implementation used for decoupled event notifications.
 */

export type Observer<T> = (value: T) => void;

export interface ObserverHub<T> {
    subscribe: (observer: Observer<T>) => () => void;
    notify: (value: T) => void;
    clear: () => void;
}

export function createObserverHub<T>(): ObserverHub<T> {
    const observers = new Set<Observer<T>>();

    return {
        subscribe: (observer) => {
            observers.add(observer);
            return () => {
                observers.delete(observer);
            };
        },
        notify: (value) => {
            observers.forEach((observer) => observer(value));
        },
        clear: () => {
            observers.clear();
        },
    };
}
