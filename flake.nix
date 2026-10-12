{
  description = "nixarchy.meeting-mode -- a quiet desktop during calls, for nixarchy";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAll = nixpkgs.lib.genAttrs systems;

      manifest = builtins.fromJSON (builtins.readFile ./manifest.json);

      pluginFor =
        pkgs:
        # Plain copies: omarchy-plugin-validate refuses any symlink inside a
        # plugin folder.
        pkgs.runCommand "nixarchy-meeting-mode-${manifest.version}"
          {
            meta = with pkgs.lib; {
              description = "Omarchy plugin: a quiet desktop during calls";
              homepage = "https://github.com/olafkfreund/nixarchy-meeting-mode";
              license = licenses.mit;
              platforms = platforms.linux;
            };
          }
          ''
            mkdir -p $out/bin $out/assets
            for f in manifest.json BarWidget.qml Service.qml Settings.qml SettingsStore.qml SettingsModel.js LICENSE preview.png; do
              cp ${./.}/$f $out/$f
            done
            cp ${./assets/icon.svg} $out/assets/icon.svg
            install -m755 ${./bin/meeting-mode-actions} $out/bin/meeting-mode-actions
            chmod -R u+w $out
            substituteInPlace $out/bin/meeting-mode-actions --replace-fail 'set -u' $'set -u\nPATH="${pkgs.jq}/bin:$PATH"  # jq is not guaranteed on PATH'
          '';
    in
    {
      nixosModules.default = import ./module.nix self;

      # For Home Manager users who do not use the NixOS module.
      homeModules.default =
        { pkgs, ... }:
        {
          programs.nixarchy.plugins.meeting-mode.src =
            self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };

      formatter = forAll (system: nixpkgs.legacyPackages.${system}.nixfmt);

      packages = forAll (system: {
        default = pluginFor nixpkgs.legacyPackages.${system};
      });

      checks = forAll (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          plugin = self.packages.${system}.default;

          # Stand-ins for the real option sites: home-manager's sharedModules at
          # the NixOS level, nixarchy's plugin option at the Home Manager level.
          nixosStub =
            { lib, ... }:
            {
              options.home-manager.sharedModules = lib.mkOption {
                type = lib.types.listOf lib.types.raw;
                default = [ ];
              };
            };
          hmStub =
            { lib, ... }:
            {
              options.programs.nixarchy.plugins = lib.mkOption {
                type = lib.types.attrsOf (
                  lib.types.submodule {
                    options.src = lib.mkOption { type = lib.types.path; };
                  }
                );
                default = { };
              };
            };
          evalWith =
            enable:
            (pkgs.lib.evalModules {
              modules = [
                self.nixosModules.default
                nixosStub
                {
                  _module.args.pkgs = pkgs;
                  programs.nixarchy.meetingMode.enable = enable;
                }
              ];
            }).config;
          hmSrc =
            modules:
            (pkgs.lib.evalModules { modules = [ hmStub ] ++ modules; })
            .config.programs.nixarchy.plugins.meeting-mode.src;
          on = evalWith true;
          off = evalWith false;
        in
        {
          default =
            pkgs.runCommand "nixarchy-meeting-mode-tests"
              {
                nativeBuildInputs = [
                  pkgs.nodejs
                  pkgs.jq
                  pkgs.coreutils
                ];
              }
              ''
                cp -r ${./.} src
                chmod -R u+w src
                cd src
                node tests/model.test.js
                node tests/qml-text.test.js
                bash tests/actions.test.sh

                jq -e '.id == "nixarchy.meeting-mode"' ${plugin}/manifest.json
                jq -e '.entryPoints | length > 0' ${plugin}/manifest.json
                for f in $(jq -r '.entryPoints[]' ${plugin}/manifest.json); do test -f ${plugin}/$f; done
                test -z "$(find ${plugin}/ -mindepth 1 -type l)"
                test -x ${plugin}/bin/meeting-mode-actions
                grep -q '${pkgs.jq}/bin' ${plugin}/bin/meeting-mode-actions
                touch $out
              '';

          shellcheck =
            pkgs.runCommand "nixarchy-meeting-mode-shellcheck" { nativeBuildInputs = [ pkgs.shellcheck ]; }
              ''
                shellcheck ${./bin/meeting-mode-actions} ${./tests/actions.test.sh}
                touch $out
              '';

          nixfmt = pkgs.runCommand "nixarchy-meeting-mode-nixfmt" { nativeBuildInputs = [ pkgs.nixfmt ]; } ''
            nixfmt --check ${./flake.nix} ${./module.nix}
            touch $out
          '';

          module =
            assert "${hmSrc on.home-manager.sharedModules}" == "${plugin}";
            assert
              "${hmSrc [
                self.homeModules.default
                { _module.args.pkgs = pkgs; }
              ]}" == "${plugin}";
            assert off.home-manager.sharedModules == [ ];
            pkgs.runCommand "nixarchy-meeting-mode-module" { } "touch $out";
        }
      );
    };
}
