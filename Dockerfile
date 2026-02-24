FROM node:20-slim

# Install curl for Foundry installer
RUN apt-get update && apt-get install -y curl git && rm -rf /var/lib/apt/lists/*

# Install Foundry
RUN curl -L https://foundry.paradigm.xyz | bash
ENV PATH="/root/.foundry/bin:${PATH}"
RUN foundryup

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json* ./
RUN npm install

# Copy project files
COPY . .

# Compile contracts on build
RUN npx hardhat compile

ENTRYPOINT ["/bin/bash"]
