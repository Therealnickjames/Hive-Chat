# Tavok SDK Agent Runner
#
# Runs a Python agent script from the examples/ directory.
# Set AGENT_SCRIPT env var to choose which example to run.
#
# Usage:
#   docker build -t tavok-agent ./sdk/python
#   docker run -e AGENT_SCRIPT=examples/echo_agent.py tavok-agent

FROM python:3.12-slim

WORKDIR /app

# Install SDK and optional dependencies
COPY pyproject.toml README.md ./
COPY tavok/ tavok/
RUN pip install --no-cache-dir ".[anthropic,openai]"

# Copy examples
COPY examples/ examples/

# Default: run echo agent
ENV AGENT_SCRIPT=examples/echo_agent.py

CMD ["sh", "-c", "python $AGENT_SCRIPT"]
