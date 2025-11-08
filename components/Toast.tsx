import React, { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ToastProps {
  message: string;
  onDismiss: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, onDismiss, duration = 3000 }) => {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration, onDismiss]);

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in-right">
      <div className="bg-green-900/90 backdrop-blur-sm text-green-100 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[300px] max-w-[500px] border border-green-700/50">
        <CheckCircle2 className="h-5 w-5 text-green-400 flex-shrink-0" />
        <span className="flex-1 text-sm">{message}</span>
        <button
          onClick={onDismiss}
          className="p-1 hover:bg-green-800/50 rounded transition-colors flex-shrink-0"
          title="Dismiss"
          aria-label="Dismiss notification"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default Toast;
