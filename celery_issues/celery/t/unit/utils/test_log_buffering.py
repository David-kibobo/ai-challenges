import logging
from unittest.mock import Mock
from celery.utils.log import LoggingProxy


def test_partial_writes_are_buffered():
    mock_logger = Mock(spec=logging.Logger)
    mock_logger.handlers = []

    proxy = LoggingProxy(mock_logger, loglevel=logging.WARNING)

    proxy.write("Load")
    proxy.write("ing")
    proxy.write("...")

    assert mock_logger.log.call_count == 0, (
        f"Premature logging! Expected 0 calls, got {mock_logger.log.call_count}. "
        "Proxy failed to buffer partial writes."
    )

    proxy.write("Done\n")

    assert mock_logger.log.call_count == 1
    args, _ = mock_logger.log.call_args
    assert args[1] == "Loading...Done"


def test_closed_proxy_flushes_buffer():
    mock_logger = Mock(spec=logging.Logger)
    mock_logger.handlers = []

    proxy = LoggingProxy(mock_logger, loglevel=logging.ERROR)

    proxy.write("Unfinished error message")

    assert (
        mock_logger.log.call_count == 0
    ), "Premature logging! The proxy flushed before close() was called."

    proxy.close()

    assert mock_logger.log.call_count == 1
    assert "Unfinished error message" in mock_logger.log.call_args[0][1]
