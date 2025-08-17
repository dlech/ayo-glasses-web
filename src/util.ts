
type CheckedResult<T> = {
    ret: T;
    err: undefined;
};

type UncheckedResult<T> = {
    ret: T | undefined;
    err: unknown | undefined;
    ok: () => this is CheckedResult<T>;
};

/**
 * Wraps a promise and returns an object indicating success or failure.
 * @param promise The promise to wrap.
 * @returns An object containing the result or error.
 */
export async function maybe<T>(promise: Promise<T>): Promise<UncheckedResult<T>> {
    try {
        const result = await promise;
        return { ret: result, err: undefined, ok: (): this is CheckedResult<T> => true };
    } catch (error) {
        return { ret: undefined, err: error, ok: (): this is CheckedResult<T> => false };
    }
}

type TaskArray = (() => unknown | Promise<unknown>)[];

async function unwind(tasks: TaskArray) {
    for (const task of tasks.reverse()) {
        try {
            await task();
        } catch (error) {
            console.debug("Error in ExitStack unwind:", error);
        }
    }
}

class ExitStack {
    private tasks: TaskArray = [];

    push(task: () => unknown | Promise<unknown>) {
        this.tasks.push(task);
    }

    async unwind() {
        unwind(this.tasks);
        this.tasks = [];
    }

    popAll(): () => Promise<void> {
        const tasks = this.tasks;
        this.tasks = [];
        return () => unwind(tasks);
    }
}

export async function withExitStack<T>(func: (stack: ExitStack) => Promise<T>): Promise<T> {
    const exitStack = new ExitStack();
    try {
        return await func(exitStack);
    } catch (error) {
        console.error("Unexpected error:", error);
        throw error;
    } finally {
        exitStack.unwind();
    }
}
