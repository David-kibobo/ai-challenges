#!/bin/bash
set -e

if [ "$1" == "base" ]; then
    echo "Running base tests (ignoring known failing suites and tests_closing)..."
    python -m  pytest tests \
        --ignore=tests/tests_closing \
         --continue-on-collection-errors \
        --ignore=tests/unit/containers/instance/test_async_resources_py36.py \
        --ignore=tests/unit/containers/instance/test_load_config_py2_py3.py \
        --ignore=tests/unit/ext/test_starlette.py \
        --ignore=tests/unit/providers/async/test_delegated_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_delegated_thread_local_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_delegated_thread_safe_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_dependency_py36.py \
        --ignore=tests/unit/providers/async/test_dict_py36.py \
        --ignore=tests/unit/providers/async/test_factory_aggregate_py36.py \
        --ignore=tests/unit/providers/async/test_factory_py36.py \
        --ignore=tests/unit/providers/async/test_list_py36.py \
        --ignore=tests/unit/providers/async/test_override_py36.py \
        --ignore=tests/unit/providers/async/test_provided_instance_py36.py \
        --ignore=tests/unit/providers/async/test_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_thread_local_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_thread_safe_singleton_py36.py \
        --ignore=tests/unit/providers/async/test_typing_stubs_py36.py \
        --ignore=tests/unit/providers/configuration/test_from_yaml_py2_py3.py \
        --ignore=tests/unit/providers/configuration/test_yaml_files_in_init_py2_py3.py \
        --ignore=tests/unit/providers/coroutines/test_coroutine_py35.py \
        --ignore=tests/unit/providers/resource/test_async_resource_py35.py \
        --ignore=tests/unit/wiring/provider_ids/test_autoloader_py36.py \
        --ignore=tests/unit/wiring/string_ids/test_async_injections_py36.py \
        --ignore=tests/unit/ext/test_aiohttp_py35.py \
        --ignore=tests/unit/ext/test_flask_py2_py3.py \
        --ignore=tests/unit/providers/configuration/test_from_pydantic_py36.py \
        --ignore=tests/unit/providers/configuration/test_from_yaml_with_env_py2_py3.py \
        --ignore=tests/unit/providers/configuration/test_pydantic_settings_in_init_py36.py \
        --ignore=tests/unit/schema/test_container_api_py36.py \
        --ignore=tests/unit/schema/test_integration_py36.py \
        --ignore=tests/unit/wiring/test_fastapi_py36.py \
        --ignore=tests/unit/wiring/test_fastdepends.py \
        --ignore=tests/unit/wiring/test_flask_py36.py\
        --ignore=tests/unit/wiring/provider_ids/test_async_injections_py36.py\
        --ignore=tests/unit/providers/callables/test_callable_py2_py3.py \
        --ignore=tests/unit/providers/factories/test_factory_py2_py3.py \
        --ignore=tests/unit/providers/resource/test_resource_py35.py \
        --ignore=tests/unit/providers/singleton/test_singleton_py2_py3.py
 

elif [ "$1" == "new" ]; then
    echo "Running new tests (only tests_closing)...."
    python -m pytest tests/tests_closing

else
    echo "Usage: ./test.sh [base|new]"
    exit 1
fi
