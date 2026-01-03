import pytest
# 1. Corrected the class name based on the ruff log discovery
from preswald.engine.base_service import BasePreswaldService

def test_should_render_logic():
    """
    Reproduction for Issue #768.
    Ensures that identical values do not trigger redundant renders.
    """
    # Initialize the service with the correct class name
    service = BasePreswaldService()
    component_id = "test_slider"
    initial_value = 10

    # 2. Use the discovered method should_render
    # We first 'prime' the state with the initial value
    service.should_render(component_id, initial_value)

    # TEST: Identical value (Should be False)
    # The bug is that this returns True even if 10 == 10
    is_changed = service.should_render(component_id, 10)
    assert is_changed is False, f"Redundant render triggered for identical integer! Got {is_changed}"

    # 3. TEST: Deep Equality with Lists (The 'Challenging' part)
    list_id = "test_list"
    val_a = [1, 2, 3]
    val_b = [1, 2, 3] # Different object in memory, same content

    service.should_render(list_id, val_a)
    is_changed_list = service.should_render(list_id, val_b)

    assert is_changed_list is False, "Redundant render triggered for deep-equal list! Likely using 'is' instead of '=='"