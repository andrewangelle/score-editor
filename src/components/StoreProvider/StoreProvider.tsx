import { useState } from 'react';
import { Provider } from 'react-redux';
import { makeStore } from '#/store';

/**
 * Start renders on the server, so the store is created per request rather than
 * as a module singleton that would leak one visitor's document into the next.
 * `useState` keeps that instance stable for the life of the client render.
 */
export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [store] = useState(makeStore);

  return <Provider store={store}>{children}</Provider>;
}
