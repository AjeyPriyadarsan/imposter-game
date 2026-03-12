import { useGame } from "./context/GameContext";
import HomePage from "./pages/HomePage";
import LobbyPage from "./pages/LobbyPage";
import GamePage from "./pages/GamePage";
import VotingPage from "./pages/VotingPage";
import ResultsPage from "./pages/ResultsPage";
import RoundEndPage from "./pages/RoundEndPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  if (window.location.pathname === "/ajey") {
    return <AdminPage />;
  }

  const { gameState, playerInfo, reconnecting } = useGame();

  if (reconnecting) return <div className="page center"><p>Reconnecting...</p></div>;
  if (!playerInfo) return <HomePage />;
  if (!gameState) return <div className="page center"><p>Connecting to room...</p></div>;

  let page;
  switch (gameState.state) {
    case "lobby":
      page = <LobbyPage />;
      break;
    case "playing":
      page = <GamePage />;
      break;
    case "voting":
      page = <VotingPage />;
      break;
    case "round_end":
      page = <RoundEndPage />;
      break;
    case "results":
      page = <ResultsPage />;
      break;
    default:
      page = <HomePage />;
  }

  return page;
}
