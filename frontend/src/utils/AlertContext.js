import { createContext, useContext } from 'react';

export const AlertContext = createContext({ decrementUnread: () => {}, clearUnread: () => {} });
export const useAlertContext = () => useContext(AlertContext);