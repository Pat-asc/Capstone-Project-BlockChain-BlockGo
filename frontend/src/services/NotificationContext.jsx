import React, { createContext, useState, useCallback, useContext } from 'react';

const NotificationContext = createContext({
    addNotification: (message, type) => console.warn("NotificationProvider missing! Message:", message)
});

export const useNotification = () => useContext(NotificationContext);

const Notification = ({ message, type, onDismiss }) => {
    const baseClasses = "fixed top-5 right-5 z-[2000] max-w-sm p-4 rounded-lg shadow-lg cursor-pointer transition-transform transform";
    const typeClasses = {
        success: "bg-green-100 border border-green-400 text-green-800",
        error: "bg-red-100 border border-red-400 text-red-800",
    };

    return (
        <div className={`${baseClasses} ${typeClasses[type]}`} onClick={onDismiss}>
            {message}
        </div>
    );
};

export const NotificationProvider = ({ children }) => {
    const [notification, setNotification] = useState(null);

    const addNotification = useCallback((message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => {
            setNotification(null);
        }, 5000); // Auto-dismiss after 5 seconds
    }, []);

    const dismissNotification = () => {
        setNotification(null);
    };

    return (
        <NotificationContext.Provider value={{ addNotification }}>
            {children}
            {notification && <Notification message={notification.message} type={notification.type} onDismiss={dismissNotification} />}
        </NotificationContext.Provider>
    );
};