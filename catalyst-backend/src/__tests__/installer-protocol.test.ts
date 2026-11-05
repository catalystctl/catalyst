import { describe, expect, it } from "vitest";
import {
  buildInstallCommand,
  type InstallCommandType,
  type ServerForInstall,
} from "../services/server-install.js";

function fixtureTemplate(): ServerForInstall {
  return {
    id: "server-a",
    uuid: "00000000-0000-4000-8000-000000000001",
    name: "Compatibility probe",
    nodeId: "node-a",
    primaryIp: null,
    primaryPort: 25565,
    allocatedMemoryMb: 2048,
    allocatedCpuCores: 2,
    allocatedDiskMb: 10240,
    networkMode: "bridge",
    environment: { MOTD: "Compatibility probe" },
    portBindings: {},
    node: { serverDataDir: "/var/lib/catalyst/servers", publicAddress: "127.0.0.1" },
    template: {
      image: "alpine:3.19",
      startup: "./server",
      installImage: "eclipse-temurin:21-jdk-jammy",
      installEntrypoint: "/opt/custom-install",
      installScript: "#!/bin/bash\nexit 0",
      variables: [{ name: "MOTD", defaultValue: "hello" }],
    },
  };
}

describe("installer compatibility wire contract", () => {
  for (const operation of [
    "install_server",
    "reinstall_server",
    "rebuild_server",
  ] satisfies InstallCommandType[]) {
    it(`${operation} preserves script, image and exact entrypoint`, () => {
      const { command } = buildInstallCommand(fixtureTemplate(), operation, { trust: "non-admin" });
      expect(command.template).toMatchObject({
        installImage: "eclipse-temurin:21-jdk-jammy",
        installEntrypoint: "/opt/custom-install",
        installScript: "#!/bin/bash\nexit 0",
      });
      expect(command.environment).toMatchObject({ MOTD: "Compatibility probe" });
      expect(command.networkMode).toBe("bridge");
    });
  }

  it("filters undeclared stored keys but preserves declarations and generated builtins", () => {
    const server = fixtureTemplate();
    server.name = "Panel generated name";
    server.environment = {
      MOTD: "Declared value",
      BASH_ENV: "/data/persisted-hook.sh",
      PATH: "/data/bin:/usr/bin:/bin",
      LD_PRELOAD: "/data/persisted-hook.so",
      SERVER_DIR: "/data/hostile-server-dir",
      STARTUP: "stored spoofed startup",
      UUID: "stored spoofed uuid",
    };

    const { command } = buildInstallCommand(server, "rebuild_server", { trust: "non-admin" });
    const environment = command.environment as Record<string, string>;
    expect(environment.MOTD).toBe("Declared value");
    expect(environment.BASH_ENV).toBeUndefined();
    expect(environment.PATH).toBeUndefined();
    expect(environment.LD_PRELOAD).toBeUndefined();
    expect(environment.SERVER_DIR).toBe(`/var/lib/catalyst/servers/${server.uuid}`);
    expect(environment.STARTUP).toBe("./server");
    expect(environment.UUID).toBe(server.uuid);
    expect(environment.SERVER_PORT).toBe(String(server.primaryPort));
    expect(environment.SERVER_MEMORY).toBe(String(server.allocatedMemoryMb));
  });

  for (const trust of ["admin", "migration", "system"] as const) {
    it(`keeps legacy stored values only for the explicit ${trust} trust context`, () => {
      const server = fixtureTemplate();
      server.environment = { MOTD: "Declared value", BASH_ENV: "/trusted/legacy.sh" };
      const { command } = buildInstallCommand(server, "install_server", { trust });
      expect(command.environment).toMatchObject({
        MOTD: "Declared value",
        BASH_ENV: "/trusted/legacy.sh",
      });
    });
  }

  it("does not invent an entrypoint for legacy templates", () => {
    const server = fixtureTemplate();
    delete server.template!.installEntrypoint;
    const { command } = buildInstallCommand(server, "install_server", { trust: "non-admin" });
    const template = command.template as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(template, "installEntrypoint")).toBe(false);
    expect(template.installScript).toBe("#!/bin/bash\nexit 0");
  });
});
