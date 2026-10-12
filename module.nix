# programs.nixarchy.plugins is a Home Manager option (nixarchy modules/home.nix):
# nixarchy validates the manifest and links the package into the plugin folder
# (installed, not enabled). Reached from NixOS through home-manager's sharedModules.
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.nixarchy.meetingMode;
in
{
  options.programs.nixarchy.meetingMode = {
    enable = lib.mkEnableOption "Meeting Mode, a quiet desktop during calls";
    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "inputs.meeting-mode.packages.\${system}.default";
      description = "The Meeting Mode plugin package.";
    };
  };

  config = lib.mkIf cfg.enable {
    home-manager.sharedModules = [
      { programs.nixarchy.plugins.meeting-mode.src = cfg.package; }
    ];
  };
}
