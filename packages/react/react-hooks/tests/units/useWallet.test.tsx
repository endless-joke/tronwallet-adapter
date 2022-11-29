import React, { createRef, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { WalletContextState } from '../../src/useWallet.js';
import { useWallet } from '../../src/useWallet.js';
import type { WalletProviderProps } from '../../src/WalletProvider.js';
import { WalletProvider } from '../../src/WalletProvider.js';
import 'jest-localstorage-mock';
import {
    Adapter,
    WalletDisconnectionError,
    WalletNotSelectedError,
    AdapterState,
    isInBrowser,
} from '@tronweb3/tronwallet-abstract-adapter';
import type { AdapterName } from '@tronweb3/tronwallet-abstract-adapter';
import { WalletNotFoundError } from '@tronweb3/tronwallet-abstract-adapter';

type TestRefType = {
    getState(): WalletContextState;
};

const TestComponent = forwardRef(function TestComponent(_props, ref) {
    const wallet = useWallet();
    useImperativeHandle(
        ref,
        () => ({
            getState() {
                return wallet;
            },
        }),
        [wallet]
    );
    return null;
});
window.open = jest.fn();
window.console.error = jest.fn();
describe('useWallet', function () {
    let root: ReturnType<typeof createRoot>;
    let ref: React.RefObject<TestRefType>;
    let container: HTMLDivElement;
    let adapter1: FakeAdapter;
    let adapter2: FakeAdapter;
    let adapter3: FakeAdapter;
    let adapters: Adapter[];

    function mountTest(props: Omit<WalletProviderProps, 'children' | 'adapters'>) {
        act(() => {
            root.render(
                <WalletProvider {...props} adapters={adapters}>
                    <TestComponent ref={ref} />
                </WalletProvider>
            );
        });
    }

    abstract class FakeAdapter extends Adapter {
        connectMethod = () => Promise.resolve();
        disconnectMethod: any = () => Promise.resolve();
        address: string | null = null;
        _connected = false;
        get connected() {
            return this._connected;
        }
        _state = AdapterState.NotFound;
        get state() {
            return this._state;
        }
        connecting = false;
        connect = jest.fn(async () => {
            if (this.state === AdapterState.NotFound) {
                isInBrowser() && window.open(this.url, '_blank');
                throw new WalletNotFoundError();
            }
            this.connecting = true;
            if (this.connectMethod) {
                try {
                    await this.connectMethod();
                } catch (error: any) {
                    act(() => {
                        this.emit('error', error);
                    });
                    throw error;
                }
            }
            this.connecting = false;
            this._connected = true;
            this._state = AdapterState.Connected;
            act(() => {
                this.emit('connect', this.address || '');
                this.emit('stateChanged', this._state);
            });
        });
        disconnect = jest.fn(async () => {
            this.connecting = false;
            if (this.disconnectMethod) {
                try {
                    await this.disconnectMethod();
                } catch (error: any) {
                    act(() => {
                        this.emit('error', error);
                    });
                    throw error;
                }
            }
            this._connected = false;
            this._state = AdapterState.Disconnect;
            act(() => {
                this.emit('disconnect');
                this.emit('stateChanged', this._state);
            });
        });
        signMessage = jest.fn();
        signTransaction = jest.fn();
    }

    class Adapter1 extends FakeAdapter {
        name = 'Adapter1' as AdapterName<'Adapter1'>;
        url = 'https://adapter1.com';
        icon = 'adapter.png';
        address = '1';
    }
    class Adapter2 extends FakeAdapter {
        name = 'Adapter2' as AdapterName<'Adapter2'>;
        url = 'https://adapter2.com';
        icon = 'adapter.png';
        address = '2';
    }
    class Adapter3 extends FakeAdapter {
        name = 'Adapter3' as AdapterName<'Adapter3'>;
        url = 'https://adapter3.com';
        icon = 'adapter.png';
        address = '3';
    }

    beforeEach(function () {
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        ref = createRef();
        adapter1 = new Adapter1();
        adapter2 = new Adapter2();
        adapter3 = new Adapter3();
        adapters = [adapter1, adapter2, adapter3];
    });
    afterEach(function () {
        act(() => {
            root?.unmount();
        });
    });

    describe('when there is no wallet ready', function () {
        beforeEach(async function () {
            act(() => {
                adapter1._state = AdapterState.NotFound;
            });
            mountTest({} as WalletProviderProps);
            await act(async () => {
                ref.current?.getState().select(adapter1.name);
                await Promise.resolve();
            });
        });
        it('connect should not be called', function () {
            expect(adapter1.connect).toHaveBeenCalledTimes(0);
        });
        it('should be ok when call disconnect', async function () {
            expect(ref.current?.getState().disconnect).not.toThrow();
        });
        it('signMessage should not be called when call signMessage', async function () {
            await act(async function () {
                await ref.current?.getState().signMessage?.('string');
            });
            expect(adapter1.signMessage).toHaveBeenCalledTimes(1);
        });
        it('signTransaction should not be called when call signTransaction', async function () {
            await act(async function () {
                await ref.current?.getState().signTransaction?.({} as any);
            });
            expect(adapter1.signTransaction).toHaveBeenCalledTimes(1);
        });
    });
    describe('when there is a wallet ready with autoConnect', function () {
        beforeEach(async function () {
            adapter1._state = AdapterState.Disconnect;
            mountTest({} as WalletProviderProps);
            await act(async () => {
                ref.current?.getState().select(adapter1.name);
                await Promise.resolve();
            });
            // auto select
            expect(ref.current?.getState().wallet?.state).toEqual(AdapterState.Connected);
        });

        it('selected wallet should be null when select a non-exist wallet', async function () {
            await act(async function () {
                ref.current?.getState().select('Non exist name' as AdapterName<'Non exist name'>);
                await Promise.resolve();
            });
            expect(ref.current?.getState().wallet).toEqual(null);
            expect(ref.current?.getState().connected).toEqual(false);
        });

        it('selected wallet should be null when disconnect', async function () {
            await act(async () => {
                await ref.current?.getState().disconnect();
                await Promise.resolve();
            });
            expect(ref.current?.getState().wallet).toEqual(null);
            expect(ref.current?.getState().connected).toEqual(false);
        });
        it('should be connected when change wallet as autoConnect enable', async function () {
            await act(async () => {
                adapter2._state = AdapterState.Disconnect;
                adapter2.emit('chainChanged', AdapterState.Disconnect);
                ref.current?.getState().select(adapter2.name);
                await Promise.resolve();
            });
            expect(ref.current?.getState().wallet?.adapter.name).toEqual(adapter2.name);
            expect(ref.current?.getState().wallet?.state).toEqual(AdapterState.Connected);
        });
    });

    describe('when there is a seleted a wallet in local storage', function () {
        beforeEach(function () {
            localStorage.setItem('tronAdapterName', JSON.stringify(adapter1.name));
            mountTest({ localStorageKey: 'tronAdapterName' } as WalletProviderProps);
        });
        it('wallet should be the selected wallet', function () {
            expect(ref.current?.getState().wallet?.adapter.name).toEqual(adapter1.name);
        });
        it('should success when change a wallet', function () {
            act(function () {
                ref.current?.getState().select(adapter2.name);
            });
            const state = ref.current?.getState();
            expect(state?.wallet?.adapter.name).toEqual(adapter2.name);
            expect(state?.connected).toEqual(false);
        });
    });
    describe('when there is no seleted a wallet in local storage', function () {
        beforeEach(function () {
            mountTest({} as WalletProviderProps);
        });
        it('wallet should be null', function () {
            expect(ref.current?.getState().wallet).toEqual(null);
        });
    });
});
