export function useTelecoCommandController(params: {
  telecoIpAddress: string;
  telecoPort: string;
  commandWsStatus: string;
}) {
  const commandConnected = params.commandWsStatus === "接続済み";
  const commandBusy = params.commandWsStatus === "接続中";

  const canConnectCommand = !commandConnected && !commandBusy;
  const canDisconnectCommand = commandConnected || commandBusy;
  const canRunMouthTest = commandConnected;

  const telecoDebugUrlForDisplay = `http://${params.telecoIpAddress.trim()}:${params.telecoPort.trim()}/`;
  const commandWsUrlForDisplay = `ws://${params.telecoIpAddress.trim()}:${params.telecoPort.trim()}/command`;
  const hasTelecoTarget =
    params.telecoIpAddress.trim().length > 0 &&
    params.telecoPort.trim().length > 0;
  const canConnectCommandNow = canConnectCommand && hasTelecoTarget;

  return {
    commandConnected,
    commandBusy,
    canConnectCommand,
    canDisconnectCommand,
    canRunMouthTest,
    telecoDebugUrlForDisplay,
    commandWsUrlForDisplay,
    hasTelecoTarget,
    canConnectCommandNow,
  };
}
