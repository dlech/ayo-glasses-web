import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { maybe, withExitStack } from "./util";
import { startAppListening } from "./listener-middleware";

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

startAppListening({
    actionCreator: ble.actions.connectBle,
    effect: async (_action, listenerApi) =>
        withExitStack(async (stack) => {
            if (navigator.bluetooth === undefined) {
                console.debug("Bluetooth not supported");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            if (!(await navigator.bluetooth.getAvailability())) {
                console.debug("Bluetooth not available");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
                console.debug(deviceResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
                console.debug("GATT not available");
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            const serverResult = await maybe(device.gatt.connect());
            if (!serverResult.ok()) {
                console.debug(serverResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            console.debug("GATT server connected:", serverResult.ret);
            stack.push(() => serverResult.ret.disconnect());

            const glassesInfoServiceResult = await maybe(
                serverResult.ret.getPrimaryService(glassesInfoServiceUuid),
            );
            if (!glassesInfoServiceResult.ok()) {
                console.debug(glassesInfoServiceResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            const classesInfoCharResult = await maybe(
                glassesInfoServiceResult.ret.getCharacteristic(
                    glassesInfoCharacteristicUuid,
                ),
            );
            if (!classesInfoCharResult.ok()) {
                console.debug(classesInfoCharResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
                console.debug(classesInfoCharStartNotifyResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            console.debug("Notifications started");
            stack.push(() => classesInfoCharResult.ret.stopNotifications());

            const deviceInfoServiceResult = await maybe(
                serverResult.ret.getPrimaryService(deviceInfoServiceUuid),
            );
            if (!deviceInfoServiceResult.ok()) {
                console.debug(deviceInfoServiceResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            console.debug("Device Info Service obtained");

            const firmwareRevisionCharResult = await maybe(
                deviceInfoServiceResult.ret.getCharacteristic(
                    firmwareRevisionCharacteristicUuid,
                ),
            );
            if (!firmwareRevisionCharResult.ok()) {
                console.debug(firmwareRevisionCharResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            const firmwareVersionResult = await maybe(
                firmwareRevisionCharResult.ret.readValue(),
            );
            if (!firmwareVersionResult.ok()) {
                console.debug(firmwareVersionResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
                console.debug(hardwareRevisionCharResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            const hardwareVersionResult = await maybe(
                hardwareRevisionCharResult.ret.readValue(),
            );
            if (!hardwareVersionResult.ok()) {
                console.debug(hardwareVersionResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
                console.debug(glassesServiceResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            console.debug("Glasses Service obtained");

            const serialNumberCharResult = await maybe(
                glassesServiceResult.ret.getCharacteristic(
                    serialNumberCharacteristicUuid,
                ),
            );
            if (!serialNumberCharResult.ok()) {
                console.debug(serialNumberCharResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
                return;
            }

            const serialNumberResult = await maybe(
                serialNumberCharResult.ret.readValue(),
            );
            if (!serialNumberResult.ok()) {
                console.debug(serialNumberResult.err);
                listenerApi.dispatch(ble.actions.didFailToConnectBle());
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
