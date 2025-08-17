import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { maybe, withExitStack } from "./util";
import { startAppListening } from "./listener-middleware";
import { toaster } from "./components/ui/toaster-global";

// Bluetooth SIG assigned numbers
const novalogyCompanyId = 0x0419;
const deviceInfoServiceUuid = 0x180a;
const firmwareRevisionCharacteristicUuid = 0x2a26;
const hardwareRevisionCharacteristicUuid = 0x2a27;

// Device-specific assigned numbers
const glassesInfoServiceUuid = "a344bc6c-aebf-44e4-908d-915f67cedd0b";
const glassesInfoCharacteristicUuid = "fc8ff009-8828-4d7a-8ec5-9aec83c39e22";
const glassesServiceUuid = "cd335528-624a-4363-b361-f62342001d00";
const serialNumberCharacteristicUuid = "a3434a49-0fef-4e6f-a65c-80e383a39b28";

const decoder = new TextDecoder();

type BleConnectStatus =
    | "disconnected"
    | "connecting"
    | "connected"
    | "disconnecting";

const ble = createSlice({
    name: "ble",
    initialState: {
        status: "disconnected" as BleConnectStatus,
        battery: NaN,
        deviceId: "",
        firmwareVersion: "",
        hardwareVersion: "",
        serialNumber: "",
    },
    reducers: {
        connectBle: (state) => {
            state.status = "connecting";
        },
        didFailToConnectBle: (state) => {
            state.status = "disconnected";
        },
        didConnectBle: (state) => {
            state.status = "connected";
        },
        disconnectBle: (state) => {
            state.status = "disconnecting";
        },
        didDisconnectBle: (state) => {
            state.status = "disconnected";
            state.battery = NaN;
            state.deviceId = "";
            state.firmwareVersion = "";
            state.hardwareVersion = "";
            state.serialNumber = "";
        },
        didGetBleDevice: (state, action: PayloadAction<string>) => {
            state.deviceId = action.payload;
        },
        didReadBatteryLevel: (state, action: PayloadAction<number>) => {
            state.battery = action.payload;
        },
        didReadFirmwareVersion: (state, action: PayloadAction<string>) => {
            state.firmwareVersion = action.payload;
        },
        didReadHardwareVersion: (state, action: PayloadAction<string>) => {
            state.hardwareVersion = action.payload;
        },
        didReadSerialNumber: (state, action: PayloadAction<string>) => {
            state.serialNumber = action.payload;
        },
    },
});

export default ble.reducer;
export const { connectBle, disconnectBle } = ble.actions;

function createUnexpectedErrorToast() {
    toaster.create({
        id: "unexpected-error",
        title: "Unexpected error",
        description:
            "Please check the console in the Web Developers Tools for more info. If the error is repeatable, please report it.",
        type: "error",
        closable: true,
        duration: 5000,
    });
}

startAppListening({
    actionCreator: ble.actions.connectBle,
    effect: async (_action, listenerApi) =>
        withExitStack(async (stack) => {
            if (navigator.bluetooth === undefined) {
                console.debug("navigator.bluetooth is undefined");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                toaster.create({
                    id: "no-web-ble",
                    title: "WebBluetooth not supported",
                    description:
                        "Please use a web browser such as Google Chrome or Microsoft Edge that supports WebBluetooth.",
                    type: "error",
                    closable: true,
                    duration: 5000,
                });
                return;
            }

            if (!(await navigator.bluetooth.getAvailability())) {
                console.debug("Bluetooth not available");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                toaster.create({
                    id: "bluetooth-unavailable",
                    title: "Bluetooth not available",
                    description:
                        "Please ensure that Bluetooth is enabled on your device and the browser has permission to access it.",
                    type: "error",
                    closable: true,
                    duration: 5000,
                });
                return;
            }

            const deviceResult = await maybe(
                navigator.bluetooth.requestDevice({
                    filters: [
                        {
                            manufacturerData: [
                                { companyIdentifier: novalogyCompanyId },
                            ],
                        },
                    ],
                    optionalServices: [
                        deviceInfoServiceUuid,
                        glassesInfoServiceUuid,
                        glassesServiceUuid,
                    ],
                }),
            );
            if (!deviceResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    deviceResult.err instanceof DOMException &&
                    deviceResult.err.name === "NotFoundError"
                ) {
                    // User cancelled the device selection dialog
                    console.debug(deviceResult.err);
                    return;
                }

                console.error(deviceResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const device = deviceResult.ret;
            console.debug("Device selected:", device);
            listenerApi.dispatch(ble.actions.didGetBleDevice(device.id));

            const onDisconnected = () => {
                listenerApi.cancel();
                listenerApi.dispatch(ble.actions.didDisconnectBle());
            };
            device.addEventListener("gattserverdisconnected", onDisconnected);
            stack.push(() =>
                device.removeEventListener(
                    "gattserverdisconnected",
                    onDisconnected,
                ),
            );

            if (device.gatt === undefined) {
                console.error("GATT not available");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                createUnexpectedErrorToast();
                return;
            }

            const serverResult = await maybe(device.gatt.connect());
            if (!serverResult.ok()) {
                console.debug(serverResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                toaster.create({
                    id: "gatt-connection-failed",
                    title: "Connection failed",
                    description:
                        "Please try again. If the problem persists, try restarting your device.",
                    type: "error",
                    closable: true,
                    duration: 5000,
                });

                return;
            }

            console.debug("GATT server connected:", serverResult.ret);
            stack.push(() => serverResult.ret.disconnect());

            const glassesInfoServiceResult = await maybe(
                serverResult.ret.getPrimaryService(glassesInfoServiceUuid),
            );
            if (!glassesInfoServiceResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    glassesInfoServiceResult.err instanceof DOMException &&
                    glassesInfoServiceResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(glassesInfoServiceResult.err);
                    return;
                }

                console.error(glassesInfoServiceResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const classesInfoCharResult = await maybe(
                glassesInfoServiceResult.ret.getCharacteristic(
                    glassesInfoCharacteristicUuid,
                ),
            );
            if (!classesInfoCharResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    classesInfoCharResult.err instanceof DOMException &&
                    classesInfoCharResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(classesInfoCharResult.err);
                    return;
                }

                console.error(classesInfoCharResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const onCharacteristicValueChanged = () => {
                console.debug("Characteristic value changed");
                const value = classesInfoCharResult.ret.value;
                if (!value) {
                    return;
                }

                console.debug(value);

                const battery = value.getUint8(0);
                listenerApi.dispatch(ble.actions.didReadBatteryLevel(battery));
            };
            classesInfoCharResult.ret.addEventListener(
                "characteristicvaluechanged",
                onCharacteristicValueChanged,
            );
            stack.push(() =>
                classesInfoCharResult.ret.removeEventListener(
                    "characteristicvaluechanged",
                    onCharacteristicValueChanged,
                ),
            );

            const classesInfoCharStartNotifyResult = await maybe(
                classesInfoCharResult.ret.startNotifications(),
            );
            if (!classesInfoCharStartNotifyResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    classesInfoCharStartNotifyResult.err instanceof
                        DOMException &&
                    classesInfoCharStartNotifyResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(classesInfoCharStartNotifyResult.err);
                    return;
                }

                console.error(classesInfoCharStartNotifyResult.err);
                createUnexpectedErrorToast();
                return;
            }

            console.debug("Notifications started");
            stack.push(() => classesInfoCharResult.ret.stopNotifications());

            const deviceInfoServiceResult = await maybe(
                serverResult.ret.getPrimaryService(deviceInfoServiceUuid),
            );
            if (!deviceInfoServiceResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    deviceInfoServiceResult.err instanceof DOMException &&
                    deviceInfoServiceResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(deviceInfoServiceResult.err);
                    return;
                }

                console.error(deviceInfoServiceResult.err);
                createUnexpectedErrorToast();
                return;
            }

            console.debug("Device Info Service obtained");

            const firmwareRevisionCharResult = await maybe(
                deviceInfoServiceResult.ret.getCharacteristic(
                    firmwareRevisionCharacteristicUuid,
                ),
            );
            if (!firmwareRevisionCharResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    firmwareRevisionCharResult.err instanceof DOMException &&
                    firmwareRevisionCharResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(firmwareRevisionCharResult.err);
                    return;
                }

                console.error(firmwareRevisionCharResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const firmwareVersionResult = await maybe(
                firmwareRevisionCharResult.ret.readValue(),
            );
            if (!firmwareVersionResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    firmwareVersionResult.err instanceof DOMException &&
                    firmwareVersionResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(firmwareVersionResult.err);
                    return;
                }

                console.error(firmwareVersionResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const firmwareVersion = decoder.decode(firmwareVersionResult.ret);
            console.debug("Firmware Version:", firmwareVersion);
            listenerApi.dispatch(
                ble.actions.didReadFirmwareVersion(firmwareVersion),
            );

            const hardwareRevisionCharResult = await maybe(
                deviceInfoServiceResult.ret.getCharacteristic(
                    hardwareRevisionCharacteristicUuid,
                ),
            );
            if (!hardwareRevisionCharResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    hardwareRevisionCharResult.err instanceof DOMException &&
                    hardwareRevisionCharResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(hardwareRevisionCharResult.err);
                    return;
                }

                console.error(hardwareRevisionCharResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const hardwareVersionResult = await maybe(
                hardwareRevisionCharResult.ret.readValue(),
            );
            if (!hardwareVersionResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    hardwareVersionResult.err instanceof DOMException &&
                    hardwareVersionResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(hardwareVersionResult.err);
                    return;
                }

                console.error(hardwareVersionResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const hardwareVersion = decoder.decode(hardwareVersionResult.ret);
            console.debug("Hardware Version:", hardwareVersion);
            listenerApi.dispatch(
                ble.actions.didReadHardwareVersion(hardwareVersion),
            );

            const glassesServiceResult = await maybe(
                device.gatt.getPrimaryService(glassesServiceUuid),
            );
            if (!glassesServiceResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    glassesServiceResult.err instanceof DOMException &&
                    glassesServiceResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(glassesServiceResult.err);
                    return;
                }

                console.error(glassesServiceResult.err);
                createUnexpectedErrorToast();
                return;
            }

            console.debug("Glasses Service obtained");

            const serialNumberCharResult = await maybe(
                glassesServiceResult.ret.getCharacteristic(
                    serialNumberCharacteristicUuid,
                ),
            );
            if (!serialNumberCharResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    serialNumberCharResult.err instanceof DOMException &&
                    serialNumberCharResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(serialNumberCharResult.err);
                    return;
                }

                console.error(serialNumberCharResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const serialNumberResult = await maybe(
                serialNumberCharResult.ret.readValue(),
            );
            if (!serialNumberResult.ok()) {
                listenerApi.dispatch(ble.actions.didFailToConnectBle());

                if (
                    serialNumberResult.err instanceof DOMException &&
                    serialNumberResult.err.name === "NetworkError"
                ) {
                    // Device disconnected
                    console.debug(serialNumberResult.err);
                    return;
                }

                console.error(serialNumberResult.err);
                createUnexpectedErrorToast();
                return;
            }

            const serialNumber = decoder.decode(serialNumberResult.ret);
            console.debug("Serial Number:", serialNumber);
            listenerApi.dispatch(ble.actions.didReadSerialNumber(serialNumber));

            listenerApi.dispatch(ble.actions.didConnectBle());

            const disconnectResult = await maybe(
                listenerApi.take(ble.actions.disconnectBle.match),
            );
            if (!disconnectResult.ok()) {
                console.debug(
                    "Error waiting for disconnect:",
                    disconnectResult.err,
                );
            }

            // exit stack unwind will take care of disconnecting
        }),
});
