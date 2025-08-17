import { createAction, createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import { maybe, withExitStack } from "./util";


const glassesInfoServiceUuid = "a344bc6c-aebf-44e4-908d-915f67cedd0b";
const glassesInfoCharacteristicUuid = "fc8ff009-8828-4d7a-8ec5-9aec83c39e22";
const glassesServiceUuid = "cd335528-624a-4363-b361-f62342001d00";
const serialNumberCharacteristicUuid = "a3434a49-0fef-4e6f-a65c-80e383a39b28";
const deviceInfoServiceUuid = 0x180A;
const firmwareRevisionCharacteristicUuid = 0x2A26;
const hardwareRevisionCharacteristicUuid = 0x2A27;

const decoder = new TextDecoder();
const connectedDevices = new Map<string, () => Promise<void>>();

export const connectBle = createAsyncThunk('ble/connect', async (_arg, thunkAPI) =>
    withExitStack(async (stack) => {
        if (navigator.bluetooth === undefined) {
            console.debug("Bluetooth not supported");
            return thunkAPI.rejectWithValue("Bluetooth not supported");
        }

        if (!await navigator.bluetooth.getAvailability()) {
            console.debug("Bluetooth not available");
            return thunkAPI.rejectWithValue("Bluetooth not available");
        }

        const deviceResult = await maybe(navigator.bluetooth.requestDevice({
            filters: [{ manufacturerData: [{ companyIdentifier: 1049 }] }],
            optionalServices: [deviceInfoServiceUuid, glassesInfoServiceUuid, glassesServiceUuid]
        }));
        if (!deviceResult.ok()) {
            console.debug(deviceResult.err);
            return thunkAPI.rejectWithValue("Error selecting device");
        }

        const device = deviceResult.ret;
        console.debug("Device selected:", device);

        const onDisconnected = () => {
            thunkAPI.abort("disconnected");
            thunkAPI.dispatch(didDisconnectBle());
        };
        device.addEventListener('gattserverdisconnected', onDisconnected);
        stack.push(() => device.removeEventListener('gattserverdisconnected', onDisconnected));

        if (device.gatt === undefined) {
            console.debug("GATT not available");
            return thunkAPI.rejectWithValue("GATT not available");
        }

        const serverResult = await maybe(device.gatt.connect());
        if (!serverResult.ok()) {
            console.debug(serverResult.err);
            return thunkAPI.rejectWithValue("Error connecting to GATT server");
        }

        console.debug("GATT server connected:", serverResult.ret);
        stack.push(() => serverResult.ret.disconnect());

        const glassesInfoServiceResult = await maybe(serverResult.ret.getPrimaryService(glassesInfoServiceUuid));
        if (!glassesInfoServiceResult.ok()) {
            console.debug(glassesInfoServiceResult.err);
            return thunkAPI.rejectWithValue("Error getting glasses info service");
        }

        const classesInfoCharResult = await maybe(glassesInfoServiceResult.ret.getCharacteristic(glassesInfoCharacteristicUuid));
        if (!classesInfoCharResult.ok()) {
            console.debug(classesInfoCharResult.err);
            return thunkAPI.rejectWithValue("Error getting glasses info characteristic");
        }

        const onCharacteristicValueChanged = () => {
            console.debug("Characteristic value changed");
            const value = classesInfoCharResult.ret.value;
            if (!value) {
                return;
            }

            console.debug(value);

            const battery = value.getUint8(0);
            thunkAPI.dispatch(ble.actions.setBattery(battery));
        };
        classesInfoCharResult.ret.addEventListener('characteristicvaluechanged', onCharacteristicValueChanged);
        stack.push(() => classesInfoCharResult.ret.removeEventListener('characteristicvaluechanged', onCharacteristicValueChanged));

        const classesInfoCharStartNotifyResult = await maybe(classesInfoCharResult.ret.startNotifications());
        if (!classesInfoCharStartNotifyResult.ok()) {
            console.debug(classesInfoCharStartNotifyResult.err);
            return thunkAPI.rejectWithValue("Error starting notifications");
        }

        console.debug("Notifications started");
        stack.push(() => classesInfoCharResult.ret.stopNotifications());

        const deviceInfoServiceResult = await maybe(serverResult.ret.getPrimaryService(deviceInfoServiceUuid));
        if (!deviceInfoServiceResult.ok()) {
            console.debug(deviceInfoServiceResult.err);
            return thunkAPI.rejectWithValue("Error getting device info service");
        }

        console.debug("Device Info Service obtained");

        const firmwareRevisionCharResult = await maybe(deviceInfoServiceResult.ret.getCharacteristic(firmwareRevisionCharacteristicUuid));
        if (!firmwareRevisionCharResult.ok()) {
            console.debug(firmwareRevisionCharResult.err);
            return thunkAPI.rejectWithValue("Error getting firmware revision characteristic");
        }

        const firmwareVersionResult = await maybe(firmwareRevisionCharResult.ret.readValue());
        if (!firmwareVersionResult.ok()) {
            console.debug(firmwareVersionResult.err);
            return thunkAPI.rejectWithValue("Error getting firmware version");
        }

        const firmwareVersion = decoder.decode(firmwareVersionResult.ret);
        console.debug("Firmware Version:", firmwareVersion);

        const hardwareRevisionCharResult = await maybe(deviceInfoServiceResult.ret.getCharacteristic(hardwareRevisionCharacteristicUuid));
        if (!hardwareRevisionCharResult.ok()) {
            console.debug(hardwareRevisionCharResult.err);
            return thunkAPI.rejectWithValue("Error getting hardware revision characteristic");
        }

        const hardwareVersionResult = await maybe(hardwareRevisionCharResult.ret.readValue());
        if (!hardwareVersionResult.ok()) {
            console.debug(hardwareVersionResult.err);
            return thunkAPI.rejectWithValue("Error getting hardware version");
        }

        const hardwareVersion = decoder.decode(hardwareVersionResult.ret);
        console.debug("Hardware Version:", hardwareVersion);

        const glassesServiceResult = await maybe(device.gatt.getPrimaryService(glassesServiceUuid));
        if (!glassesServiceResult.ok()) {
            console.debug(glassesServiceResult.err);
            return thunkAPI.rejectWithValue("Error getting glasses service");
        }

        console.debug("Glasses Service obtained");

        const serialNumberCharResult = await maybe(glassesServiceResult.ret.getCharacteristic(serialNumberCharacteristicUuid));
        if (!serialNumberCharResult.ok()) {
            console.debug(serialNumberCharResult.err);
            return thunkAPI.rejectWithValue("Error getting serial number characteristic");
        }

        const serialNumberResult = await maybe(serialNumberCharResult.ret.readValue());
        if (!serialNumberResult.ok()) {
            console.debug(serialNumberResult.err);
            return thunkAPI.rejectWithValue("Error getting serial number");
        }

        const serialNumber = decoder.decode(serialNumberResult.ret);
        console.debug("Serial Number:", serialNumber);

        connectedDevices.set(device.id, stack.popAll());

        return {
            deviceId: device.id,
            firmwareVersion,
            hardwareVersion,
            serialNumber,
        };
    })
);

export const disconnectBle = createAsyncThunk('ble/disconnect', async (arg: string) =>
    withExitStack(async () => {
        const disconnectTask = connectedDevices.get(arg);
        if (disconnectTask) {
            connectedDevices.delete(arg);
            await disconnectTask();
        } else {
            console.error("Device not found in connectedDevices");
        }
    })
);

const didDisconnectBle = createAction('ble/didDisconnect');


type BleConnectStatus = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

const ble = createSlice({
    name: 'ble',
    initialState: {
        status: 'disconnected' as BleConnectStatus,
        battery: NaN,
        deviceId: '',
        firmwareVersion: '',
        hardwareVersion: '',
        serialNumber: '',
    },
    reducers: {
        setBattery: (state, action) => {
            state.battery = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(disconnectBle.pending, (state) => {
                state.status = 'disconnecting';
            })
            .addCase(didDisconnectBle, (state) => {
                state.status = 'disconnected';
                state.battery = NaN;
                state.deviceId = '';
                state.firmwareVersion = '';
                state.hardwareVersion = '';
                state.serialNumber = '';
            })
            .addCase(connectBle.pending, (state) => {
                state.status = 'connecting';
            })
            .addCase(connectBle.fulfilled, (state, action) => {
                state.status = 'connected';
                state.deviceId = action.payload.deviceId;
                state.firmwareVersion = action.payload.firmwareVersion;
                state.hardwareVersion = action.payload.hardwareVersion;
                state.serialNumber = action.payload.serialNumber;
            })
            .addCase(connectBle.rejected, (state) => {
                state.status = 'disconnected';
            });
    }
});

export default ble.reducer;
