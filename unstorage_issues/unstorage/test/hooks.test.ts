import { describe, it, expect, vi } from "vitest";
import { createStorage } from "../src/index.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Lifecycle Hooks (#613)", () => {
    it("should redirect key in before-hook and override value in after-hook (getItem)", async () => {
        const storage = createStorage({
            hooks: {
                "item:get:before": async (ctx) => {
                    await delay(5);
                    if (ctx.key === "alias") ctx.key = "real";
                },
                "item:get:after": async (ctx) => {
                    await delay(5);
                    ctx.value = "modified_" + ctx.value;
                }
            }
        } as any);

        await storage.setItem("real", "data");
        const val = await storage.getItem("alias");

        expect(val).toBe("modified_data");
    });

    it("should support key and value mutation in single setItem", async () => {
        const setItemSpy = vi.fn();
        const driver = {
            setItem: setItemSpy,
            hasItem: () => false,
            getItem: () => null,
            removeItem: () => { },
            getKeys: () => [],
        };

        const storage = createStorage({
            driver: driver as any,
            hooks: {
                "item:set:before": async (ctx) => {
                    ctx.key = "redirected_key";
                    ctx.value = { mutated: true };
                }
            }
        } as any);

        await storage.setItem("original_key", "original_value");

        expect(setItemSpy).toHaveBeenCalledWith(
            "redirected_key",
            expect.stringContaining('"mutated":true'),
            expect.anything()
        );
    });

    it("should propagate mutated opts to driver", async () => {
        const getItemSpy = vi.fn(() => "val");
        const driver = {
            getItem: getItemSpy,
            hasItem: () => false,
            setItem: () => { },
            removeItem: () => { },
            getKeys: () => [],
        };

        const storage = createStorage({
            driver: driver as any,
            hooks: {
                "item:get:before": async (ctx) => {
                    ctx.opts.customFlag = 12345;
                }
            }
        } as any);

        await storage.getItem("test_key");

        expect(getItemSpy).toHaveBeenCalledWith("test_key", expect.objectContaining({ customFlag: 12345 }));
    });

    it("should support soft cancellation for getItem, setItem, and removeItem", async () => {
        const getItemSpy = vi.fn();
        const setItemSpy = vi.fn();
        const removeItemSpy = vi.fn();
        const logs: string[] = [];

        const driver = {
            getItem: getItemSpy,
            setItem: setItemSpy,
            removeItem: removeItemSpy,
            hasItem: () => false,
            getKeys: () => [],
        };

        const storage = createStorage({
            driver: driver as any,
            hooks: {
                "item:get:before": async (ctx) => { ctx.cancelled = true; logs.push("get:before"); },
                "item:get:after": async () => logs.push("get:after"),

                "item:set:before": async (ctx) => { ctx.cancelled = true; logs.push("set:before"); },
                "item:set:after": async () => logs.push("set:after"),

                "item:remove:before": async (ctx) => { ctx.cancelled = true; logs.push("remove:before"); },
                "item:remove:after": async () => logs.push("remove:after"),
            }
        } as any);

        await storage.getItem("foo");
        expect(getItemSpy).not.toHaveBeenCalled();
        expect(logs).toEqual(["get:before", "get:after"]);

        logs.length = 0;
        await storage.setItem("foo", "bar");
        expect(setItemSpy).not.toHaveBeenCalled();
        expect(logs).toEqual(["set:before", "set:after"]);

        logs.length = 0;
        await storage.removeItem("foo");
        expect(removeItemSpy).not.toHaveBeenCalled();
        expect(logs).toEqual(["remove:before", "remove:after"]);
    });

    it("should filter cancelled items and serialize mutations in batch setItems", async () => {
        const setItemSpy = vi.fn();
        const setItemsSpy = vi.fn();
        const logs: string[] = [];

        const driver = {
            hasItem: () => false,
            getItem: () => null,
            setItem: setItemSpy,
            setItems: setItemsSpy,
            removeItem: () => { },
            getKeys: () => [],
        };

        const storage = createStorage({
            driver: driver as any,
            hooks: {
                "item:set:before": async (ctx) => {
                    if (ctx.key === "cancel_me") ctx.cancelled = true;
                    if (ctx.key === "mutate_me") ctx.value = { changed: true };
                    logs.push(`before:${ctx.key}`);
                },
                "item:set:after": async (ctx) => {
                    logs.push(`after:${ctx.key}`);
                }
            }
        } as any);

        await storage.setItems([
            { key: "mutate_me", value: 1 },
            { key: "cancel_me", value: 2 }
        ]);


        const mutatedWasPersisted =
            setItemSpy.mock.calls.some(args =>
                args[0] === "mutate_me" &&
                typeof args[1] === "string" &&
                args[1].includes('"changed":true')
            ) ||
            setItemsSpy.mock.calls.some(args =>
                Array.isArray(args[0]) &&
                args[0].some((i: any) =>
                    i.key === "mutate_me" &&
                    typeof i.value === "string" &&
                    i.value.includes('"changed":true')
                )
            );

        expect(mutatedWasPersisted).toBe(true);


        const cancelledWasPersisted =
            setItemSpy.mock.calls.some(args => args[0] === "cancel_me") ||
            setItemsSpy.mock.calls.some(args =>
                Array.isArray(args[0]) &&
                args[0].some((i: any) => i.key === "cancel_me")
            );

        expect(cancelledWasPersisted).toBe(false);


        expect(logs).toEqual(expect.arrayContaining([
            "before:mutate_me", "after:mutate_me",
            "before:cancel_me", "after:cancel_me"
        ]));
    });

    it("should trigger legacy removeMeta via hook opts mutation", async () => {
        const removeItemSpy = vi.fn();
        const driver = {
            removeItem: removeItemSpy,
            hasItem: () => false,
            getKeys: () => []
        };

        const storage = createStorage({
            driver: driver as any,
            hooks: {
                "item:remove:before": async (ctx) => {
                    ctx.opts.removeMeta = true;
                }
            }
        } as any);

        await storage.removeItem("obj");

        expect(removeItemSpy).toHaveBeenCalledTimes(2);
        expect(removeItemSpy).toHaveBeenCalledWith("obj", expect.anything());
        expect(removeItemSpy).toHaveBeenCalledWith("obj$", expect.anything());
    });

    it("should cancel all operations on before-hook error", async () => {
        const storage = createStorage({
            hooks: {
                "item:set:before": async (ctx) => {
                    if (ctx.key === "block_set") throw new Error("NoSet");
                },
                "item:get:before": async (ctx) => {
                    if (ctx.key === "block_get") throw new Error("NoGet");
                },
                "item:remove:before": async (ctx) => {
                    if (ctx.key === "block_remove") throw new Error("NoRemove");
                }
            }
        } as any);

        await expect(storage.setItem("block_set", "val")).rejects.toThrow("NoSet");
        await expect(storage.getItem("block_get")).rejects.toThrow("NoGet");
        await expect(storage.removeItem("block_remove")).rejects.toThrow("NoRemove");
    });
});
