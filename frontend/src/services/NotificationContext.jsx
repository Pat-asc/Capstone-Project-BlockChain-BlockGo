import React, { createContext, useState, useCallback, useContext, useRef } from 'react';

const NotificationContext = createContext({
    addNotification: (message, type) => console.warn("NotificationProvider missing! Message:", message)
});

const DISMISS_SUPPRESSION_MS = 10000;

export const useNotification = () => useContext(NotificationContext);

const Notification = ({ message, type, onDismiss }) => {
    const baseClasses = "max-w-sm rounded-lg p-4 shadow-lg cursor-pointer transition-transform transform";
    const typeClasses = {
        success: "bg-green-100 border border-green-400 text-green-800",
        error: "bg-red-100 border border-red-400 text-red-800",
    };

    return (
        <div className={`${baseClasses} ${typeClasses[type] || typeClasses.success}`} onClick={onDismiss}>
            {message}
        </div>
    );
};

export const NotificationProvider = ({ children }) => {
    const [notifications, setNotifications] = useState([]);
    const dismissedMessagesRef = useRef(new Map());

    const addNotification = useCallback((message, type = 'success') => {
        const normalizedMessage = String(message || '').trim();
        if (!normalizedMessage) return;

        const dismissedAt = dismissedMessagesRef.current.get(normalizedMessage);
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_SUPPRESSION_MS) {
            return;
        }

        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setNotifications((prev) => {
            const alreadyVisible = prev.some((notification) => notification.message === normalizedMessage);
            if (alreadyVisible) return prev;
            return [...prev, { id, message: normalizedMessage, type }].slice(-4);
        });
        setTimeout(() => {
            setNotifications((prev) => prev.filter((notification) => notification.id !== id));
        }, 5000); // Auto-dismiss after 5 seconds
    }, []);

    const dismissNotification = (id, message) => {
        dismissedMessagesRef.current.set(String(message || '').trim(), Date.now());
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            {notifications.length > 0 && (
                <div className="fixed top-5 right-5 z-[2000] flex max-w-sm flex-col gap-3">
                    {notifications.map((notification) => (
                        <Notification
                            key={notification.id}
                            message={notification.message}
                            type={notification.type}
                            onDismiss={() => dismissNotification(notification.id, notification.message)}
                        />
                    ))}
                </div>
            )}
        </NotificationContext.Provider>
    );
};
