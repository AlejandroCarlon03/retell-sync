"""Tests for retell_sync.config — defaults, env parsing, and secret validation."""

from __future__ import annotations

import pytest

from retell_sync.config import (
    AlertConfig,
    AppConfig,
    ConfigError,
    OdooConfig,
    RetellConfig,
)


# --------------------------------------------------------------------------- #
#  Defaults                                                                    #
# --------------------------------------------------------------------------- #
def test_default_config_has_expected_business_hours():
    cfg = AppConfig.default()
    assert cfg.business_hours.start_hour == 8
    assert cfg.business_hours.end_hour == 17
    assert cfg.business_hours.workdays == (0, 1, 2, 3, 4)


def test_default_config_has_no_secrets():
    cfg = AppConfig.default()
    assert cfg.retell.api_key is None
    assert cfg.odoo.url is None
    assert cfg.odoo.api_key is None


def test_default_conversion_lookback_and_funnel():
    cfg = AppConfig.default()
    assert cfg.conversion.lookback_days == 35
    assert cfg.conversion.funnel_stage_order[0] == "new"
    assert "won" in cfg.conversion.funnel_stage_order
    assert cfg.conversion.new_client_grace_hours == 12.0


def test_from_env_reads_new_client_grace_hours():
    cfg = AppConfig.from_env({"RETELL_NEW_CLIENT_GRACE_HOURS": "6"})
    assert cfg.conversion.new_client_grace_hours == 6.0


def test_from_env_new_client_grace_hours_defaults_and_ignores_garbage():
    assert AppConfig.from_env({}).conversion.new_client_grace_hours == 12.0
    # A typo degrades to the default rather than crashing the run.
    assert (
        AppConfig.from_env({"RETELL_NEW_CLIENT_GRACE_HOURS": "abc"})
        .conversion.new_client_grace_hours
        == 12.0
    )


# --------------------------------------------------------------------------- #
#  Alert (SLA digest) config                                                   #
# --------------------------------------------------------------------------- #
def test_default_alert_config_is_off_with_48h_window():
    cfg = AppConfig.default()
    assert cfg.alert.enabled is False
    assert cfg.alert.sla_hours == 48.0
    # Ships with DKB's freshly-created stages as the un-actioned backstop.
    assert "New Customer / Need Info" in cfg.alert.unactioned_stages


def test_from_env_reads_alert_prefs():
    cfg = AppConfig.from_env(
        {
            "RETELL_ALERT_ENABLED": "true",
            "RETELL_ALERT_SLA_HOURS": "24",
            "RETELL_ALERT_UNACTIONED_STAGES": "Stage A, Stage B ,  ",
        }
    )
    assert cfg.alert.enabled is True
    assert cfg.alert.sla_hours == 24.0
    # Items trimmed, blanks dropped.
    assert cfg.alert.unactioned_stages == ("Stage A", "Stage B")


def test_from_env_alert_defaults_and_ignores_garbage():
    cfg = AppConfig.from_env({})
    assert cfg.alert.enabled is False
    assert cfg.alert.sla_hours == 48.0
    assert cfg.alert.unactioned_stages == AlertConfig.unactioned_stages

    # A typo can't silently flip the feature on or wipe the stage list.
    cfg2 = AppConfig.from_env(
        {"RETELL_ALERT_ENABLED": "maybe", "RETELL_ALERT_SLA_HOURS": "abc",
         "RETELL_ALERT_UNACTIONED_STAGES": "   "}
    )
    assert cfg2.alert.enabled is False
    assert cfg2.alert.sla_hours == 48.0
    assert cfg2.alert.unactioned_stages == AlertConfig.unactioned_stages


@pytest.mark.parametrize(
    "raw,expected",
    [("1", True), ("YES", True), ("On", True), ("0", False), ("false", False), ("off", False)],
)
def test_from_env_alert_enabled_bool_tokens(raw, expected):
    assert AppConfig.from_env({"RETELL_ALERT_ENABLED": raw}).alert.enabled is expected


# --------------------------------------------------------------------------- #
#  Alert M365 / Graph send config (PR B)                                       #
# --------------------------------------------------------------------------- #
def test_default_alert_has_no_graph_secrets():
    alert = AppConfig.default().alert
    assert alert.graph_tenant_id is None
    assert alert.graph_client_id is None
    assert alert.graph_client_secret is None
    assert alert.alert_from is None
    assert alert.alert_recipients == ()


def test_from_env_reads_graph_send_fields():
    cfg = AppConfig.from_env(
        {
            "GRAPH_TENANT_ID": "tenant-123",
            "GRAPH_CLIENT_ID": "client-123",
            "GRAPH_CLIENT_SECRET": "shh",
            "ALERT_FROM": "afterhours@dkbinc.co",
            "ALERT_TO": "alex@dkbinc.co, sam@dkbinc.co ,  ",
        }
    )
    alert = cfg.alert
    assert alert.graph_tenant_id == "tenant-123"
    assert alert.graph_client_id == "client-123"
    assert alert.graph_client_secret == "shh"
    assert alert.alert_from == "afterhours@dkbinc.co"
    # Recipients split, trimmed, blanks dropped.
    assert alert.alert_recipients == ("alex@dkbinc.co", "sam@dkbinc.co")


def test_require_graph_passes_when_complete():
    alert = AppConfig.from_env(
        {
            "GRAPH_TENANT_ID": "t", "GRAPH_CLIENT_ID": "c",
            "GRAPH_CLIENT_SECRET": "s", "ALERT_FROM": "from@x.co",
            "ALERT_TO": "to@x.co",
        }
    ).alert
    assert alert.require_graph() is alert


def test_require_graph_names_every_missing_field():
    with pytest.raises(ConfigError) as exc:
        AppConfig.default().alert.require_graph()
    msg = str(exc.value)
    for name in ("GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET",
                 "ALERT_FROM", "ALERT_TO"):
        assert name in msg


def test_require_graph_flags_missing_recipient_only():
    # Everything but a recipient -> only ALERT_TO is reported.
    alert = AppConfig.from_env(
        {"GRAPH_TENANT_ID": "t", "GRAPH_CLIENT_ID": "c",
         "GRAPH_CLIENT_SECRET": "s", "ALERT_FROM": "from@x.co"}
    ).alert
    with pytest.raises(ConfigError, match="ALERT_TO"):
        alert.require_graph()


# --------------------------------------------------------------------------- #
#  Env parsing (hermetic — explicit mapping, no os.environ)                    #
# --------------------------------------------------------------------------- #
def test_from_env_reads_secrets_from_explicit_mapping():
    env = {
        "RETELL_API_KEY": "rk_test",
        "ODOO_URL": "https://odoo.example.com/api",
        "ODOO_API_KEY": "odoo_test",
    }
    cfg = AppConfig.from_env(env)
    assert cfg.retell.api_key == "rk_test"
    assert cfg.odoo.url == "https://odoo.example.com/api"
    assert cfg.odoo.api_key == "odoo_test"


def test_from_env_treats_blank_strings_as_missing():
    cfg = AppConfig.from_env({"RETELL_API_KEY": "", "ODOO_URL": "", "ODOO_API_KEY": ""})
    assert cfg.retell.api_key is None
    assert cfg.odoo.url is None
    assert cfg.odoo.api_key is None


def test_from_env_allows_base_url_override():
    cfg = AppConfig.from_env({"RETELL_BASE_URL": "https://eu.api.retellai.com"})
    assert cfg.retell.base_url == "https://eu.api.retellai.com"


def test_from_env_defaults_base_url_when_absent():
    cfg = AppConfig.from_env({})
    assert cfg.retell.base_url == RetellConfig.base_url


# --------------------------------------------------------------------------- #
#  Secret validation                                                          #
# --------------------------------------------------------------------------- #
def test_retell_require_raises_without_key():
    with pytest.raises(ConfigError, match="RETELL_API_KEY"):
        RetellConfig().require()


def test_retell_require_passes_with_key():
    cfg = RetellConfig(api_key="rk_test")
    assert cfg.require() is cfg


def test_odoo_require_reports_all_missing():
    with pytest.raises(ConfigError) as excinfo:
        OdooConfig().require()
    message = str(excinfo.value)
    assert "ODOO_URL" in message
    assert "ODOO_API_KEY" in message


def test_odoo_require_passes_when_complete():
    cfg = OdooConfig(url="https://odoo.example.com", api_key="k")
    assert cfg.require() is cfg


# --------------------------------------------------------------------------- #
#  Paths                                                                       #
# --------------------------------------------------------------------------- #
def test_paths_resolve_relative_to_root(tmp_path):
    cfg = AppConfig.default()
    cfg = cfg.__class__(
        paths=cfg.paths.__class__(root=tmp_path),
    )
    resolved = cfg.paths.resolved()
    assert resolved.data_dir == tmp_path / "data"
    assert resolved.output_dir == tmp_path / "outputs"
