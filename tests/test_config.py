"""Tests for retell_sync.config — defaults, env parsing, and secret validation."""

from __future__ import annotations

import pytest

from retell_sync.config import (
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
