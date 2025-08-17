import { combineReducers, configureStore } from "@reduxjs/toolkit";
import ble from "./ble";
import { listenerMiddleware } from "./listener-middleware";

export const store = configureStore({
    reducer: combineReducers({
        ble,
    }),
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().prepend(listenerMiddleware.middleware),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
