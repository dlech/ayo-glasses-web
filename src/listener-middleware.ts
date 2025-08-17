import { addListener, createListenerMiddleware } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "./store";

// Best to define this in a separate file, to avoid importing
// from the store file into the rest of the codebase
export const listenerMiddleware = createListenerMiddleware();

export const startAppListening = listenerMiddleware.startListening.withTypes<
    RootState,
    AppDispatch
>();

export const addAppListener = addListener.withTypes<RootState, AppDispatch>();
