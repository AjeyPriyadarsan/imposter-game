import { useGame } from "./context/GameContext";
import HomePage from "./pages/HomePage";
import LobbyPage from "./pages/LobbyPage";
import GamePage from "./pages/GamePage";
import VotingPage from "./pages/VotingPage";
import ResultsPage from "./pages/ResultsPage";

export default function App() {
  const { gameState, playerInfo, reconnecting } = useGame();

  if (reconnecting) {
    return (
      <div className="page center">
        <p>Reconnecting...</p>
      </div>
    );
  }

  if (!playerInfo) return <HomePage />;

  if (!gameState) {
    return (
      <div className="page center">
        <p>Connecting to room...</p>
      </div>
    );
  }

  switch (gameState.state) {
    case "lobby":
      return <LobbyPage />;
    case "playing":
      return <GamePage />;
    case "voting":
      return <VotingPage />;
    case "results":
      return <ResultsPage />;
    default:
      return <HomePage />;
  }
}
